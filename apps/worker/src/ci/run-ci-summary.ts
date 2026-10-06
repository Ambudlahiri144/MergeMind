import type {
  InstallationView,
  InstallationsRepository,
  RepositoriesRepository,
  UsageLedgerRepository,
} from '@mergemind/db';
import {
  ciWorkflowMarker,
  extractCiRun,
  parseRepoFullName,
  renderCiPassing,
  renderCiSummary,
  type CiAnalysis,
  type CiLogExcerpt,
  type GithubApp,
  type GithubInstallationClient,
  type RepoRef,
} from '@mergemind/github';
import { LlmUnavailableError, type CiSummaryLlm, type LlmCallRecord } from '@mergemind/llm';
import {
  POLICY_FILE_PATH,
  evaluateBudget,
  parsePolicy,
  usagePeriod,
  type CiSummary,
  type CiSummaryJobData,
} from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';

import { escalateVisibility } from '../repository-visibility.js';
import { extractFailureWindow } from './extract-log.js';

/** At most this many failed jobs are fetched and summarised per run. */
export const MAX_FAILED_JOBS = 3;
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out']);
const LOW_CONFIDENCE = 0.5;

export type CiSummaryDeps = {
  installations: InstallationsRepository;
  repositories: RepositoriesRepository;
  usageLedger: UsageLedgerRepository;
  github: GithubApp;
  llm: CiSummaryLlm;
  logger: Logger;
  now: () => Date;
};

export type CiJobMeta = { jobId: string; isFinalAttempt: boolean };

export type CiCommentAction = 'created' | 'updated' | 'unchanged';

export type CiSummaryOutcome =
  | { status: 'skipped'; reason: string }
  | {
      status: 'completed';
      mode: 'analysed' | 'logs_only' | 'passed';
      comments: { prNumber: number; action: CiCommentAction }[];
    };

type Target = { prNumber: number; existing: { id: number; body: string } | null };

/** Open PRs whose head is still this run's commit (a newer push makes the run stale). */
async function resolveTargets(
  client: GithubInstallationClient,
  repoRef: RepoRef,
  data: CiSummaryJobData,
): Promise<number[]> {
  if (data.prNumbers.length === 0) {
    // Fork PRs: GitHub links none to the run, so look them up by the head commit.
    const pulls = await client.listPullRequestsForCommit({ ...repoRef, sha: data.headSha });
    return pulls
      .filter((pr) => pr.state === 'open' && pr.headSha === data.headSha)
      .map((pr) => pr.number);
  }
  const states = await Promise.all(
    data.prNumbers.map((pullNumber) => client.getPullRequestState({ ...repoRef, pullNumber })),
  );
  return states
    .filter((pr) => pr.state === 'open' && pr.headSha === data.headSha)
    .map((pr) => pr.number);
}

/**
 * True when the comment already describes this run attempt or a newer one: a redelivery,
 * a retried job, or a late event for an older attempt never overwrites newer news.
 */
function isAlreadyCurrent(body: string, data: CiSummaryJobData): boolean {
  const current = extractCiRun(body);
  if (!current) {
    return false;
  }
  return (
    current.runId > data.workflowRunId ||
    (current.runId === data.workflowRunId && current.attempt >= data.runAttempt)
  );
}

function toAnalysis(summary: CiSummary, excerpts: readonly CiLogExcerpt[]): CiAnalysis {
  const evidence = summary.evidenceLines.flatMap((number) => {
    for (const excerpt of excerpts) {
      const line = excerpt.lines.find((candidate) => candidate.number === number);
      if (line) {
        return [{ jobName: excerpt.jobName, number, text: line.text }];
      }
    }
    return [];
  });
  return {
    failingStep: summary.failingStep,
    likelyCause: summary.likelyCause,
    suggestedFix: summary.suggestedFix,
    evidence,
  };
}

type Analysed = { analysis: CiAnalysis | null; excerpts: CiLogExcerpt[]; notes: string[] };

/** Failed jobs → log windows → (budget and allowlist permitting) one LLM summary. */
async function analyseFailure(
  client: GithubInstallationClient,
  repoRef: RepoRef,
  data: CiSummaryJobData,
  context: {
    meta: CiJobMeta;
    installationId: string;
    repositoryId: string;
    isPrivateRepo: boolean;
    allowedProviders: InstallationView['allowedProviders'];
    monthlyTokenBudget: number;
  },
  deps: CiSummaryDeps,
  log: Logger,
): Promise<Analysed> {
  const notes: string[] = [];
  const jobs = await client.listRunJobs({
    ...repoRef,
    runId: data.workflowRunId,
    attempt: data.runAttempt,
  });
  const failedJobs = jobs.filter((job) => FAILED_CONCLUSIONS.has(job.conclusion ?? ''));
  if (failedJobs.length > MAX_FAILED_JOBS) {
    notes.push(
      `${failedJobs.length} jobs failed; the first ${MAX_FAILED_JOBS} are summarised here.`,
    );
  }

  const excerpts: CiLogExcerpt[] = [];
  let unavailableLogs = 0;
  for (const job of failedJobs.slice(0, MAX_FAILED_JOBS)) {
    const text = await client.getJobLog({ ...repoRef, jobId: job.id });
    if (text === null) {
      unavailableLogs += 1;
      continue;
    }
    const failedStep = job.steps.find((step) => FAILED_CONCLUSIONS.has(step.conclusion ?? ''));
    const { excerpt } = extractFailureWindow({
      jobName: job.name,
      jobUrl: job.htmlUrl,
      failedStep: failedStep?.name ?? null,
      log: text,
    });
    if (excerpt.lines.length > 0) {
      excerpts.push(excerpt);
    }
  }
  if (failedJobs.length === 0) {
    notes.push(
      'GitHub reports no failed job for this run (it may have failed before any job started).',
    );
  }
  if (unavailableLogs > 0) {
    notes.push(
      `The logs of ${unavailableLogs} failed job${unavailableLogs === 1 ? ' are' : 's are'} no longer available (expired or deleted).`,
    );
  }
  if (excerpts.length === 0) {
    return { analysis: null, excerpts, notes };
  }

  const usedTokens = await deps.usageLedger.sumTokensForPeriod(
    context.installationId,
    usagePeriod(deps.now()),
  );
  if (evaluateBudget(usedTokens, context.monthlyTokenBudget) === 'exhausted') {
    notes.push('The monthly token budget is used up, so only the log excerpt is shown.');
    return { analysis: null, excerpts, notes };
  }

  const recordCalls = (calls: readonly LlmCallRecord[]) =>
    deps.usageLedger.record(
      calls.map((call) => ({
        installationId: context.installationId,
        repositoryId: context.repositoryId,
        kind: 'ci_summary' as const,
        provider: call.provider,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        latencyMs: call.latencyMs,
        isFallback: call.isFallback,
        period: usagePeriod(deps.now()),
      })),
    );

  try {
    const result = await deps.llm.summarize({
      runId: `ci-${data.githubRepoId}-${data.workflowRunId}-${data.runAttempt}`,
      workflowName: data.workflowName,
      excerpts,
      isPrivateRepo: context.isPrivateRepo,
      allowedProviders: context.allowedProviders,
    });
    await recordCalls(result.calls);
    if (!result.summary) {
      notes.push('The AI summary was empty, so only the log excerpt is shown.');
      return { analysis: null, excerpts, notes };
    }
    if (result.summary.confidence < LOW_CONFIDENCE) {
      notes.push('MergeMind is not confident about this cause; check the log excerpt.');
    }
    return { analysis: toAnalysis(result.summary, excerpts), excerpts, notes };
  } catch (error) {
    if (!(error instanceof LlmUnavailableError)) {
      throw error;
    }
    await recordCalls(error.calls);
    // Retry an outage; with no provider allowed at all (private repo), a retry cannot help.
    if (!context.meta.isFinalAttempt && error.calls.length > 0) {
      throw error;
    }
    log.warn({ err: error }, 'ci.llmUnavailable');
    notes.push(
      error.calls.length === 0
        ? 'No AI provider is allowed for this repository, so only the log excerpt is shown.'
        : 'The AI summary is unavailable right now, so only the log excerpt is shown.',
    );
    return { analysis: null, excerpts, notes };
  }
}

/**
 * `ci-summary.run` (PRD F10, ADR-028): explain a failed workflow run in one PR comment per
 * workflow, or mark that comment passing again. Idempotent: the comment's run marker says which
 * run attempt it already describes, and the comment write is the last step.
 */
export async function runCiSummary(
  data: CiSummaryJobData,
  meta: CiJobMeta,
  deps: CiSummaryDeps,
): Promise<CiSummaryOutcome> {
  const log = deps.logger.child({ jobId: meta.jobId, repo: data.repoFullName });
  const skip = (reason: string): CiSummaryOutcome => {
    log.info({ reason, outcome: data.outcome }, 'ci.skipped');
    return { status: 'skipped', reason };
  };

  const known = await deps.repositories.findByGithubRepoId(data.githubRepoId);
  if (!known) {
    return skip('unknown_repository');
  }
  if (!known.isInstalled || !known.isEnabled) {
    return skip('repository_disabled');
  }
  const repository = await escalateVisibility(known, data.isPrivate, deps.repositories);
  const installation = await deps.installations.findByGithubId(data.githubInstallationId);
  if (!installation) {
    return skip('unknown_installation');
  }

  const repoRef = parseRepoFullName(data.repoFullName);
  const client = await deps.github.forInstallation(data.githubInstallationId);
  const prNumbers = await resolveTargets(client, repoRef, data);
  if (prNumbers.length === 0) {
    return skip('no_open_pr_at_head');
  }
  // The default branch's policy, never the run's head: a branch cannot opt itself out (ADR-033).
  const policyRef =
    repository.defaultBranch ?? (await client.getRepositoryInfo(repoRef)).defaultBranch;
  const policy = parsePolicy(
    await client.getFileText({ ...repoRef, path: POLICY_FILE_PATH, ref: policyRef }),
  );
  if (!policy.policy.ciSummary.enabled) {
    return skip('ci_summary_disabled');
  }

  const marker = ciWorkflowMarker(data.workflowId);
  const targets: Target[] = await Promise.all(
    prNumbers.map(async (prNumber) => ({
      prNumber,
      existing: await client.findIssueCommentByMarker({
        ...repoRef,
        issueNumber: prNumber,
        marker,
      }),
    })),
  );
  const pending = targets.filter(
    ({ existing }) => existing === null || !isAlreadyCurrent(existing.body, data),
  );
  const unchanged = targets
    .filter((target) => !pending.includes(target))
    .map(({ prNumber }) => ({ prNumber, action: 'unchanged' as const }));
  const run = {
    workflowId: data.workflowId,
    workflowName: data.workflowName,
    runId: data.workflowRunId,
    runNumber: data.runNumber,
    runAttempt: data.runAttempt,
    runUrl: data.htmlUrl,
    headSha: data.headSha,
  };

  if (data.outcome === 'passed') {
    // Only an earlier failure summary is rewritten; a PR that never failed gets no comment.
    const comments: { prNumber: number; action: CiCommentAction }[] = [...unchanged];
    for (const { prNumber, existing } of pending) {
      if (existing === null || extractCiRun(existing.body)?.outcome === 'passed') {
        comments.push({ prNumber, action: 'unchanged' });
        continue;
      }
      await client.updateIssueComment({
        ...repoRef,
        commentId: existing.id,
        body: renderCiPassing(run),
      });
      comments.push({ prNumber, action: 'updated' });
    }
    log.info({ mode: 'passed', comments }, 'ci.completed');
    return { status: 'completed', mode: 'passed', comments };
  }

  if (pending.length === 0) {
    log.info({ mode: 'logs_only', comments: unchanged }, 'ci.completed');
    return { status: 'completed', mode: 'logs_only', comments: unchanged };
  }
  const analysed = await analyseFailure(
    client,
    repoRef,
    data,
    {
      meta,
      installationId: installation.id,
      repositoryId: repository.id,
      isPrivateRepo: repository.isPrivate,
      allowedProviders: installation.allowedProviders,
      monthlyTokenBudget: installation.monthlyTokenBudget,
    },
    deps,
    log,
  );
  const body = renderCiSummary({ ...run, ...analysed });

  // Last step: a crash before it retries cleanly, a crash after it is caught by the marker.
  const comments: { prNumber: number; action: CiCommentAction }[] = [...unchanged];
  for (const { prNumber, existing } of pending) {
    if (existing) {
      await client.updateIssueComment({ ...repoRef, commentId: existing.id, body });
      comments.push({ prNumber, action: 'updated' });
    } else {
      await client.createIssueComment({ ...repoRef, issueNumber: prNumber, body });
      comments.push({ prNumber, action: 'created' });
    }
  }
  const mode = analysed.analysis ? 'analysed' : 'logs_only';
  log.info(
    { mode, comments, excerpts: analysed.excerpts.length, notes: analysed.notes.length },
    'ci.completed',
  );
  return { status: 'completed', mode, comments };
}
