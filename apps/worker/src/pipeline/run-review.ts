import {
  EMPTY_REVIEW_COUNTS,
  type FindingView,
  type ReviewRunView,
  type RunCounts,
  type RunTokens,
} from '@mergemind/db';
import {
  anchorFinding,
  commentableLines,
  countChangedLines,
  extractFingerprint,
  renderCheckOutput,
  renderInlineComment,
  renderNoticeBody,
  renderReviewBody,
  runMarker,
  toFileDiff,
  type BodyFinding,
  type CommentAnchor,
  type GithubInstallationClient,
  type InlineComment,
} from '@mergemind/github';
import { promptVersionFor } from '@mergemind/llm';
import {
  DEFAULT_POLICY,
  POLICY_FILE_PATH,
  createIgnoreMatcher,
  evaluateBudget,
  evaluateGate,
  usagePeriod,
  type FileDiff,
  type GateConclusion,
  type PolicyResult,
  type ReviewPass,
  type ReviewPrJobData,
  type ReviewRunMode,
  type SkipReason,
} from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';

import { chunkFiles } from './chunk-hunks.js';
import { decideSkip, loadBaseContext, loadPolicy, type BaseContext } from './load-context.js';
import { classifyFindings, gateSeverities, prepareFindings } from './post-process.js';
import { runPasses } from './run-passes.js';
import {
  ReviewRetryableError,
  type ReviewDeps,
  type ReviewJobMeta,
  type ReviewOutcome,
} from './types.js';

const MAX_LISTED_FILES = 10;
const PERCENT = 100;

/** Mutable state of one run while it executes. */
type Session = {
  base: BaseContext;
  client: GithubInstallationClient;
  policy: PolicyResult;
  run: ReviewRunView;
  deps: ReviewDeps;
  meta: ReviewJobMeta;
  log: Logger;
  startedAtMs: number;
  checkRunId: number | null;
  notes: string[];
  isBudgetWarning: boolean;
  timings: { queuedMs: number; fetchMs: number; llmMs: number; publishMs: number };
};

type FinishInput = {
  conclusion: GateConclusion;
  mode: ReviewRunMode;
  counts?: RunCounts;
  skipReason?: SkipReason;
  headline?: string;
};

function elapsedSince(deps: ReviewDeps, startMs: number): number {
  return Math.max(0, deps.now().getTime() - startMs);
}

function listFiles(paths: readonly string[]): string {
  const shown = paths.slice(0, MAX_LISTED_FILES).map((path) => `\`${path}\``);
  const more = paths.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** Run record for a skip that happens before any check run exists (silent skips, stage 2). */
async function recordSilentSkip(
  base: BaseContext,
  skipReason: SkipReason,
  policy: PolicyResult | null,
  run: ReviewRunView | null,
  deps: ReviewDeps,
  log: Logger,
): Promise<ReviewOutcome> {
  const target =
    run ??
    (
      await deps.reviewRuns.startOrResume({
        repositoryId: base.repository.id,
        pullRequestId: base.pullRequest.id,
        headSha: base.data.headSha,
        baseSha: base.data.baseSha,
        trigger: base.data.trigger,
        attempt: 1,
        promptVersion: promptVersionFor(DEFAULT_POLICY.review.passes),
      })
    ).run;
  await deps.reviewRuns.complete(target.id, {
    mode: 'skipped',
    gateConclusion: 'neutral',
    counts: { ...EMPTY_REVIEW_COUNTS },
    timings: { ...target.timings, totalMs: 0 },
    isBudgetWarning: false,
    policyErrors: policy?.errors ?? [],
    skipReason,
  });
  log.info({ runId: target.id, skipReason }, 'review.skipped');
  return { runId: target.id, status: 'skipped', mode: 'skipped', skipReason };
}

async function finish(session: Session, input: FinishInput): Promise<ReviewOutcome> {
  const { base, client, deps, run } = session;
  const counts = input.counts ?? { ...EMPTY_REVIEW_COUNTS };
  if (session.checkRunId !== null) {
    const output = renderCheckOutput({
      conclusion: input.conclusion,
      counts,
      notes: session.notes,
      ...(input.headline === undefined ? {} : { headline: input.headline }),
    });
    await client.completeCheckRun({
      ...base.repoRef,
      checkRunId: session.checkRunId,
      conclusion: input.conclusion,
      ...output,
    });
  }
  const timings = {
    ...session.timings,
    retrieveMs: 0,
    totalMs: elapsedSince(deps, session.startedAtMs),
  };
  await deps.reviewRuns.complete(run.id, {
    mode: input.mode,
    gateConclusion: input.conclusion,
    counts,
    timings,
    isBudgetWarning: session.isBudgetWarning,
    policyErrors: session.policy.errors,
    ...(input.skipReason === undefined ? {} : { skipReason: input.skipReason }),
  });
  session.log.info(
    { runId: run.id, mode: input.mode, conclusion: input.conclusion, counts, timings },
    input.mode === 'skipped' ? 'review.skipped' : 'review.completed',
  );
  return {
    runId: run.id,
    status: input.mode === 'skipped' ? 'skipped' : 'completed',
    mode: input.mode,
    gateConclusion: input.conclusion,
    ...(input.skipReason === undefined ? {} : { skipReason: input.skipReason }),
  };
}

/** Finds a review this run already posted (crash after createReview) before posting one. */
async function postReviewOnce(
  session: Session,
  body: string,
  comments: readonly InlineComment[],
): Promise<number> {
  const { base, client, deps, run } = session;
  const reviewId =
    (await client.findReviewByMarker({
      ...base.repoRef,
      pullNumber: base.data.prNumber,
      marker: runMarker(run.id),
    })) ??
    (await client.createReview({
      ...base.repoRef,
      pullNumber: base.data.prNumber,
      commitId: base.data.headSha,
      body,
      comments,
    }));
  await deps.reviewRuns.setGithubReviewId(run.id, reviewId);
  return reviewId;
}

type Analysis = { counts: RunCounts; failedPasses: ReviewPass[]; tokens: RunTokens };

async function analyze(
  session: Session,
  reviewable: readonly FileDiff[],
  filesByPath: ReadonlyMap<string, FileDiff>,
): Promise<Analysis | 'all_failed'> {
  const { base, deps, policy, run } = session;
  const llmStartedAt = deps.now().getTime();
  const result = await runPasses(deps.llm, {
    runId: run.id,
    passes: policy.policy.review.passes,
    chunks: chunkFiles(reviewable, deps.config.chunkTokens),
    persona: policy.policy.persona,
    isPrivateRepo: base.repository.isPrivate,
    allowedProviders: base.installation.allowedProviders,
    concurrency: deps.config.passConcurrency,
  });
  session.timings.llmMs = elapsedSince(deps, llmStartedAt);

  // Ledger first: tokens were spent even if the rest of the run fails (PRD F9).
  const period = usagePeriod(deps.now());
  await deps.usageLedger.record(
    result.calls.map((call) => ({
      installationId: base.installation.id,
      repositoryId: base.repository.id,
      reviewRunId: run.id,
      kind: 'review' as const,
      provider: call.provider,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      isFallback: call.isFallback,
      period,
    })),
  );
  if (result.isAllFailed) {
    return 'all_failed';
  }

  const { prepared, droppedCount } = prepareFindings(result.findings, filesByPath);
  const fingerprints = prepared.map((finding) => finding.fingerprint);
  const [suppressed, alreadyReported] = await Promise.all([
    deps.suppressions.findSuppressed(base.repository.id, fingerprints),
    deps.findings.findExistingFingerprints(base.pullRequest.id, fingerprints),
  ]);
  const { toStore, counts } = classifyFindings(prepared, {
    suppressed,
    alreadyReported,
    minConfidence: policy.policy.review.minConfidence,
    maxInlineComments: deps.config.maxInlineComments,
  });
  counts.filtered += droppedCount;
  await deps.findings.insertForRun(
    { reviewRunId: run.id, pullRequestId: base.pullRequest.id, repositoryId: base.repository.id },
    toStore,
  );
  const tokens = result.calls.reduce(
    (total, call) => ({
      input: total.input + call.inputTokens,
      output: total.output + call.outputTokens,
    }),
    { input: 0, output: 0 },
  );
  const analysis: Analysis = { counts, failedPasses: result.failedPasses, tokens };
  await deps.reviewRuns.markAnalyzed(run.id, { mode: 'full', ...analysis }, deps.now());
  return analysis;
}

function splitPlacement(
  open: readonly FindingView[],
  filesByPath: ReadonlyMap<string, FileDiff>,
): { inline: { finding: FindingView; anchor: CommentAnchor }[]; body: BodyFinding[] } {
  const inline: { finding: FindingView; anchor: CommentAnchor }[] = [];
  const body: BodyFinding[] = [];
  for (const finding of open) {
    const file = filesByPath.get(finding.path);
    const anchor = file ? anchorFinding(finding, commentableLines(file)) : null;
    if (finding.placement === 'inline' && anchor !== null) {
      inline.push({ finding, anchor });
      continue;
    }
    const placementReason =
      finding.severity === 'minor' ? 'minor' : anchor === null ? 'outside_diff' : 'overflow';
    body.push({ ...finding, placementReason });
  }
  return { inline, body };
}

async function publish(
  session: Session,
  analysis: Analysis,
  filesByPath: ReadonlyMap<string, FileDiff>,
): Promise<void> {
  const { base, client, deps, run } = session;
  const publishStartedAt = deps.now().getTime();
  const stored = await deps.findings.listForRun(run.id);
  const open = stored.filter((finding) => finding.state === 'open');
  const { inline, body } = splitPlacement(open, filesByPath);
  const shouldPost =
    open.length > 0 || analysis.failedPasses.length > 0 || session.policy.errors.length > 0;

  if (shouldPost && run.githubReviewId === undefined) {
    const reviewId = await postReviewOnce(
      session,
      renderReviewBody({
        runId: run.id,
        headSha: base.data.headSha,
        counts: analysis.counts,
        inlineCount: inline.length,
        bodyFindings: body,
        notes: session.notes,
      }),
      inline.map(({ finding, anchor }) => ({
        path: finding.path,
        line: anchor.line,
        ...(anchor.startLine === undefined ? {} : { startLine: anchor.startLine }),
        body: renderInlineComment(finding),
      })),
    );
    const comments = await client.listReviewComments({
      ...base.repoRef,
      pullNumber: base.data.prNumber,
      reviewId,
    });
    await deps.findings.setCommentIds(
      run.id,
      comments.flatMap((comment) => {
        const fingerprint = extractFingerprint(comment.body);
        return fingerprint === null ? [] : [{ fingerprint, githubCommentId: comment.id }];
      }),
    );
  }
  session.timings.publishMs = elapsedSince(deps, publishStartedAt);
}

/** Stages 3-13, once a run exists and passed the silent skips. */
async function reviewWithCheckRun(session: Session): Promise<ReviewOutcome> {
  const { base, client, deps, policy, run } = session;
  const reviewPolicy = policy.policy.review;
  if (policy.errors.length > 0) {
    session.notes.push(
      `Invalid \`${POLICY_FILE_PATH}\`, defaults applied: ${policy.errors.join('; ')}`,
    );
  }

  // Stage 3: budget (PRD F9).
  const usedTokens = await deps.usageLedger.sumTokensForPeriod(
    base.installation.id,
    usagePeriod(deps.now()),
  );
  const budget = evaluateBudget(usedTokens, base.installation.monthlyTokenBudget);

  // Stage 4: check run, reused when the job is retried.
  if (session.checkRunId === null) {
    session.checkRunId = await client.createCheckRun({
      ...base.repoRef,
      headSha: base.data.headSha,
      externalId: run.id,
    });
    await deps.reviewRuns.setCheckRunId(run.id, session.checkRunId);
  }
  if (budget === 'exhausted') {
    session.notes.push(
      `This installation used its monthly token budget (${base.installation.monthlyTokenBudget.toLocaleString('en-US')} tokens). Reviews resume next month or when the budget is raised.`,
    );
    return finish(session, {
      conclusion: 'neutral',
      mode: 'skipped',
      skipReason: 'budget_exhausted',
      headline: 'Skipped: monthly token budget used up',
    });
  }
  if (budget === 'warn') {
    session.isBudgetWarning = true;
    const percent = Math.floor((usedTokens / base.installation.monthlyTokenBudget) * PERCENT);
    session.notes.push(`${percent}% of this month's token budget is used.`);
  }

  // Stage 5: diff.
  const fetchStartedAt = deps.now().getTime();
  const files = (
    await client.listPullRequestFiles({ ...base.repoRef, pullNumber: base.data.prNumber })
  ).map(toFileDiff);
  session.timings.fetchMs = elapsedSince(deps, fetchStartedAt);
  const isIgnored = createIgnoreMatcher(reviewPolicy.ignorePaths);
  const considered = files.filter((file) => file.status !== 'removed' && !isIgnored(file.path));
  const reviewable = considered.filter((file) => file.hasPatch && file.hunks.length > 0);
  const notReviewed = considered.filter((file) => !file.hasPatch).map((file) => file.path);
  if (notReviewed.length > 0) {
    session.notes.push(`Not reviewed (binary or too large to diff): ${listFiles(notReviewed)}`);
  }
  if (reviewable.length === 0) {
    return finish(session, {
      conclusion: 'neutral',
      mode: 'skipped',
      skipReason: 'no_reviewable_changes',
      headline: 'Nothing to review',
    });
  }

  // Stage 6: size gate → summary_only, no LLM calls.
  const changedLines = countChangedLines(reviewable);
  const chunkCount = chunkFiles(reviewable, deps.config.chunkTokens).length;
  if (changedLines > reviewPolicy.maxChangedLines || chunkCount > deps.config.maxChunksPerRun) {
    const notice = `This PR changes ${changedLines.toLocaleString('en-US')} lines in ${reviewable.length} files, above the review limit (${reviewPolicy.maxChangedLines.toLocaleString('en-US')} changed lines), so MergeMind skipped the line-by-line review. Split the PR, or raise \`review.maxChangedLines\` in \`${POLICY_FILE_PATH}\`.`;
    if (run.githubReviewId === undefined) {
      await postReviewOnce(session, renderNoticeBody(run.id, notice, session.notes), []);
    }
    session.notes.unshift(notice);
    return finish(session, {
      conclusion: 'neutral',
      mode: 'summary_only',
      headline: 'Summary only: PR too large to review',
    });
  }

  // Stages 7-11: chunk, passes, post-process, reconcile (skipped when resuming).
  const filesByPath = new Map(reviewable.map((file) => [file.path, file]));
  let analysis: Analysis;
  if (run.analyzedAt === undefined) {
    const analyzed = await analyze(session, reviewable, filesByPath);
    if (analyzed === 'all_failed') {
      if (!session.meta.isFinalAttempt) {
        throw new ReviewRetryableError('No LLM provider could review this PR');
      }
      session.notes.push('No LLM provider could review this PR after several attempts.');
      return finish(session, {
        conclusion: 'neutral',
        mode: 'full',
        headline: 'Review unavailable: no LLM provider responded',
      });
    }
    analysis = analyzed;
  } else {
    analysis = { counts: run.counts, failedPasses: run.failedPasses, tokens: run.tokens };
    session.timings.llmMs = run.timings.llmMs;
  }
  if (analysis.failedPasses.length > 0) {
    session.notes.push(
      `No LLM provider completed the ${analysis.failedPasses.join(', ')} pass for every part of the diff, so this review may be incomplete.`,
    );
  }

  // Stage 12: publish, unless a newer commit arrived meanwhile.
  const latest = await deps.pullRequests.findByNumber(base.repository.id, base.data.prNumber);
  if (latest !== null && latest.headSha !== base.data.headSha) {
    return finish(session, {
      conclusion: 'neutral',
      mode: 'skipped',
      skipReason: 'superseded',
      headline: 'Superseded by a newer commit',
    });
  }
  await publish(session, analysis, filesByPath);
  const conclusion = evaluateGate(policy.policy.gate.failOn, gateSeverities(analysis.counts));
  const outcome = await finish(session, { conclusion, mode: 'full', counts: analysis.counts });
  await deps.pullRequests.setLastReviewedSha(
    base.repository.id,
    base.data.prNumber,
    base.data.headSha,
  );
  return outcome;
}

async function closeFailedRun(session: Session, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (session.checkRunId !== null) {
      await session.client.completeCheckRun({
        ...session.base.repoRef,
        checkRunId: session.checkRunId,
        conclusion: 'neutral',
        title: 'Review failed',
        summary:
          'MergeMind hit an error and could not finish this review. Push a new commit to try again.',
      });
    }
    await session.deps.reviewRuns.fail(session.run.id, { code: 'review_failed', message });
  } catch (closeError) {
    session.log.error({ err: closeError, runId: session.run.id }, 'review.closeFailedRunFailed');
  }
}

/**
 * The `review.pr` pipeline (Architecture.md §1). Idempotent: a replayed job returns the
 * completed run, a retried job resumes it (check run, analysis and posted review are reused;
 * ADR-018).
 */
export async function runReview(
  data: ReviewPrJobData,
  meta: ReviewJobMeta,
  deps: ReviewDeps,
): Promise<ReviewOutcome> {
  const startedAtMs = deps.now().getTime();
  const log = deps.logger.child({
    jobId: meta.jobId,
    repo: data.repoFullName,
    prNumber: data.prNumber,
    headSha: data.headSha,
  });
  const base = await loadBaseContext(data, deps);

  const silentSkip = decideSkip(base);
  if (silentSkip !== null) {
    return recordSilentSkip(base, silentSkip, null, null, deps, log);
  }

  const client = await deps.github.forInstallation(data.githubInstallationId);
  const policy = await loadPolicy(client, base);
  const { run } = await deps.reviewRuns.startOrResume({
    repositoryId: base.repository.id,
    pullRequestId: base.pullRequest.id,
    headSha: data.headSha,
    baseSha: data.baseSha,
    trigger: data.trigger,
    attempt: 1,
    promptVersion: promptVersionFor(policy.policy.review.passes),
  });
  // A finished review is final; a skipped one is re-evaluated (draft → ready, budget reset).
  if (run.status === 'completed' && run.mode !== 'skipped') {
    log.info({ runId: run.id }, 'review.replayed');
    return {
      runId: run.id,
      status: 'replayed',
      mode: run.mode,
      ...(run.gateConclusion === undefined ? {} : { gateConclusion: run.gateConclusion }),
    };
  }
  const policySkip = decideSkip(base, policy);
  if (policySkip !== null) {
    return recordSilentSkip(base, policySkip, policy, run, deps, log);
  }

  const session: Session = {
    base,
    client,
    policy,
    run,
    deps,
    meta,
    log: log.child({ runId: run.id }),
    startedAtMs,
    checkRunId: run.checkRunId ?? null,
    notes: [],
    isBudgetWarning: false,
    timings: {
      queuedMs: Math.max(0, startedAtMs - meta.enqueuedAt),
      fetchMs: 0,
      llmMs: 0,
      publishMs: 0,
    },
  };
  try {
    return await reviewWithCheckRun(session);
  } catch (error) {
    if (meta.isFinalAttempt) {
      await closeFailedRun(session, error);
    }
    throw error;
  }
}
