import {
  EMPTY_REVIEW_COUNTS,
  type CodeChunkHit,
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
  extractResolvedFingerprint,
  renderCheckOutput,
  renderInlineComment,
  renderNoticeBody,
  renderResolvedReply,
  renderReviewBody,
  runMarker,
  toFileDiff,
  type BodyFinding,
  type CommentAnchor,
  type GithubInstallationClient,
  type InlineComment,
} from '@mergemind/github';
import { isProviderAllowed, promptVersionFor, type ContextSnippet } from '@mergemind/llm';
import pLimit from 'p-limit';
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

import { chunkFiles, type ReviewChunk } from './chunk-hunks.js';
import {
  COMPARE_FALLBACK_REASONS,
  changedHeadLines,
  countHunkChanges,
  currentIssueRegions,
  findResolvedFindings,
  scopeToChanges,
} from './incremental.js';
import { decideSkip, loadBaseContext, loadPolicy, type BaseContext } from './load-context.js';
import { classifyFindings, gateSeverities, prepareFindings } from './post-process.js';
import {
  NAME_RESULTS,
  VECTOR_RESULTS,
  extractCalledNames,
  queryTextFor,
  selectContext,
} from './retrieve-context.js';
import { runPasses } from './run-passes.js';
import {
  ReviewRetryableError,
  type ReviewDeps,
  type ReviewJobMeta,
  type ReviewOutcome,
} from './types.js';

const MAX_LISTED_FILES = 10;
const SHORT_SHA_LENGTH = 7;
const RETRIEVAL_CONCURRENCY = 3;
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
  timings: {
    queuedMs: number;
    fetchMs: number;
    retrieveMs: number;
    llmMs: number;
    publishMs: number;
  };
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
        attempt: base.data.attempt,
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

/** What this run sends to the LLM (ADR-023). */
type ReviewScope = {
  mode: 'full' | 'incremental';
  /** PR-diff files (scoped hunks only, for incremental) reviewed by the passes. */
  files: FileDiff[];
  /** lastReviewedSha...head diff; empty for a full review. */
  compareFiles: FileDiff[];
};

/** Stage 6b: incremental when this is a push after a completed review and GitHub can compare. */
async function decideScope(
  session: Session,
  reviewable: readonly FileDiff[],
): Promise<ReviewScope> {
  const { base, client } = session;
  const lastReviewedSha = base.pullRequest.lastReviewedSha;
  const full = (reason?: string): ReviewScope => {
    if (reason !== undefined) {
      session.notes.push(`Full review: ${reason}.`);
    }
    return { mode: 'full', files: [...reviewable], compareFiles: [] };
  };
  if (
    base.data.trigger !== 'synchronize' ||
    lastReviewedSha === undefined ||
    lastReviewedSha === base.data.headSha
  ) {
    return full();
  }
  const compare = await client.compareCommits({
    ...base.repoRef,
    base: lastReviewedSha,
    head: base.data.headSha,
  });
  if (compare === null) {
    return full(COMPARE_FALLBACK_REASONS.unavailable);
  }
  if (compare.status !== 'ahead') {
    return full(COMPARE_FALLBACK_REASONS.notAhead);
  }
  if (compare.isTruncated) {
    return full(COMPARE_FALLBACK_REASONS.truncated);
  }
  const compareFiles = compare.files.map(toFileDiff);
  const files = scopeToChanges(reviewable, changedHeadLines(compareFiles));
  session.notes.push(
    `Incremental review: re-reviewed ${files.length} file${files.length === 1 ? '' : 's'} changed since \`${lastReviewedSha.slice(0, SHORT_SHA_LENGTH)}\`.`,
  );
  return { mode: 'incremental', files, compareFiles };
}

/**
 * Stage 8: related repository code per review chunk (PRD F6, ADR-025). Optional: an index that is
 * not ready, a disallowed embedding provider, or a failing vector search all mean "no context".
 */
async function retrieveContexts(
  session: Session,
  chunks: readonly ReviewChunk[],
): Promise<ContextSnippet[][]> {
  const { base, deps } = session;
  const none = chunks.map((): ContextSnippet[] => []);
  const isAllowed = isProviderAllowed('ollama', {
    isPrivateRepo: base.repository.isPrivate,
    allowedProviders: base.installation.allowedProviders,
  });
  if (base.repository.indexStatus !== 'ready' || !isAllowed || chunks.length === 0) {
    return none;
  }
  const limit = pLimit(RETRIEVAL_CONCURRENCY);
  // Each source degrades on its own: no vector index (or Ollama down) still leaves name lookups.
  let vectorError: unknown;
  const searchSimilar = async (query: string): Promise<CodeChunkHit[]> => {
    if (query === '' || vectorError !== undefined) {
      return [];
    }
    try {
      const { embedding } = await deps.embedder.embedQuery(query);
      return await deps.codeChunks.vectorSearch(base.repository.id, embedding, VECTOR_RESULTS);
    } catch (error) {
      vectorError = error;
      return [];
    }
  };
  try {
    const contexts = await Promise.all(
      chunks.map((chunk) =>
        limit(async () => {
          const [vectorHits, nameHits] = await Promise.all([
            searchSimilar(queryTextFor(chunk)),
            deps.codeChunks.findByNames(
              base.repository.id,
              extractCalledNames(chunk),
              NAME_RESULTS,
            ),
          ]);
          return selectContext(chunk, nameHits, vectorHits);
        }),
      ),
    );
    if (vectorError !== undefined) {
      session.log.warn({ err: vectorError }, 'review.vectorSearchUnavailable');
    }
    session.log.info(
      { snippets: contexts.reduce((total, context) => total + context.length, 0) },
      'review.contextRetrieved',
    );
    return contexts;
  } catch (error) {
    session.log.warn({ err: error }, 'review.contextUnavailable');
    return none;
  }
}

async function analyze(
  session: Session,
  scope: ReviewScope,
  filesByPath: ReadonlyMap<string, FileDiff>,
): Promise<Analysis | 'all_failed'> {
  const { base, deps, policy, run } = session;
  const chunks = chunkFiles(scope.files, deps.config.chunkTokens);
  const retrieveStartedAt = deps.now().getTime();
  const contexts = await retrieveContexts(session, chunks);
  session.timings.retrieveMs = elapsedSince(deps, retrieveStartedAt);
  const llmStartedAt = deps.now().getTime();
  const result = await runPasses(deps.llm, {
    runId: run.id,
    passes: policy.policy.review.passes,
    chunks,
    contexts,
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
  const [suppressed, alreadyReported, openFindings] = await Promise.all([
    deps.suppressions.findSuppressed(base.repository.id, fingerprints),
    deps.findings.findExistingFingerprints(base.pullRequest.id, fingerprints),
    deps.findings.listOpenForPr(base.pullRequest.id, run.id),
  ]);
  const { toStore, counts } = classifyFindings(prepared, {
    suppressed,
    alreadyReported,
    openIssues: currentIssueRegions(openFindings, scope.compareFiles),
    minConfidence: policy.policy.review.minConfidence,
    maxInlineComments: deps.config.maxInlineComments,
  });
  counts.filtered += droppedCount;
  await deps.findings.insertForRun(
    { reviewRunId: run.id, pullRequestId: base.pullRequest.id, repositoryId: base.repository.id },
    toStore,
  );

  // Stage 11b: earlier findings this push fixed (incremental only; ADR-023).
  if (scope.mode === 'incremental') {
    const minConfidence = policy.policy.review.minConfidence;
    const resolved = findResolvedFindings({
      openFindings,
      compareFiles: scope.compareFiles,
      currentIssues: prepared.filter((finding) => finding.confidence >= minConfidence),
    });
    counts.resolved = await deps.findings.markResolved(
      resolved.map((finding) => finding.id),
      { sha: base.data.headSha, runId: run.id },
    );
  }
  // The gate covers every open finding on the PR, not just this run's (ADR-023).
  Object.assign(counts, await deps.findings.countOpenBySeverity(base.pullRequest.id));

  const tokens = result.calls.reduce(
    (total, call) => ({
      input: total.input + call.inputTokens,
      output: total.output + call.outputTokens,
    }),
    { input: 0, output: 0 },
  );
  const analysis: Analysis = { counts, failedPasses: result.failedPasses, tokens };
  await deps.reviewRuns.markAnalyzed(run.id, { mode: scope.mode, ...analysis }, deps.now());
  return analysis;
}

/**
 * Replies "Resolved in <sha>" on each finding this run resolved, once (reply marker), then
 * resolves their threads when GitHub allows it (Contents: write; ADR-023).
 */
async function publishResolutions(session: Session): Promise<void> {
  const { base, client, deps, run } = session;
  const resolved = (await deps.findings.listResolvedByRun(run.id)).filter(
    (finding) => finding.githubCommentId !== undefined,
  );
  if (resolved.length === 0) {
    return;
  }
  const pullRef = { ...base.repoRef, pullNumber: base.data.prNumber };
  const existing = await client.listPullRequestComments(pullRef);
  const replied = new Set(existing.map((comment) => extractResolvedFingerprint(comment.body)));
  for (const finding of resolved) {
    if (!replied.has(finding.fingerprint)) {
      await client.replyToReviewComment({
        ...pullRef,
        commentId: finding.githubCommentId ?? 0,
        body: renderResolvedReply(finding.fingerprint, base.data.headSha),
      });
    }
  }
  const threads = await client.resolveReviewThreads({
    ...pullRef,
    commentIds: resolved.map((finding) => finding.githubCommentId ?? 0),
  });
  if (threads.isPermissionDenied) {
    session.log.info({ count: resolved.length }, 'review.threadResolveUnavailable');
  }
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
  await publishResolutions(session);
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

  // Stage 6b: incremental scope (only hunks changed since the last review).
  const scope = await decideScope(session, reviewable);

  // Stage 6: size gate → summary_only, no LLM calls.
  const changedLines =
    scope.mode === 'incremental' ? countHunkChanges(scope.files) : countChangedLines(reviewable);
  const chunkCount = chunkFiles(scope.files, deps.config.chunkTokens).length;
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
  // Anchoring always uses the full PR diff, even when only some hunks were reviewed.
  const filesByPath = new Map(reviewable.map((file) => [file.path, file]));
  let analysis: Analysis;
  let mode: ReviewRunMode = scope.mode;
  if (run.analyzedAt === undefined) {
    const analyzed = await analyze(session, scope, filesByPath);
    if (analyzed === 'all_failed') {
      if (!session.meta.isFinalAttempt) {
        throw new ReviewRetryableError('No LLM provider could review this PR');
      }
      session.notes.push('No LLM provider could review this PR after several attempts.');
      return finish(session, {
        conclusion: 'neutral',
        mode: scope.mode,
        headline: 'Review unavailable: no LLM provider responded',
      });
    }
    analysis = analyzed;
  } else {
    analysis = { counts: run.counts, failedPasses: run.failedPasses, tokens: run.tokens };
    mode = run.mode;
    session.timings.llmMs = run.timings.llmMs;
  }
  if (analysis.counts.resolved > 0) {
    session.notes.push(
      `Resolved ${analysis.counts.resolved} earlier finding${analysis.counts.resolved === 1 ? '' : 's'} fixed by this push.`,
    );
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
  const outcome = await finish(session, { conclusion, mode, counts: analysis.counts });
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
    // A manual rerun is a new attempt: a fresh run, check run and marker (ADR-031).
    attempt: data.attempt,
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
      retrieveMs: 0,
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
