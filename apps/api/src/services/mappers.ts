import type { FindingView, PullRequestView, RepositoryView, ReviewRunView } from '@mergemind/db';
import type { FindingItem, PullRequestItem, RepositoryItem, RunSummary } from '@mergemind/shared';

// Database views -> HTTP response shapes (schemas in @mergemind/shared/api).

export function toRunSummary(run: ReviewRunView): RunSummary {
  return {
    id: run.id,
    headSha: run.headSha,
    attempt: run.attempt,
    trigger: run.trigger,
    mode: run.mode,
    status: run.status,
    gateConclusion: run.gateConclusion ?? null,
    skipReason: run.skipReason ?? null,
    counts: {
      critical: run.counts.critical,
      major: run.counts.major,
      minor: run.counts.minor,
      resolved: run.counts.resolved,
    },
    durationMs: Math.max(0, Math.round(run.timings.totalMs)),
    createdAt: run.createdAt.toISOString(),
  };
}

export function toRepositoryItem(
  repository: RepositoryView,
  openPullRequests: number,
  lastReviewAt: Date | undefined,
): RepositoryItem {
  return {
    id: repository.id,
    installationId: repository.installationId,
    fullName: repository.fullName,
    isPrivate: repository.isPrivate,
    isEnabled: repository.isEnabled,
    isInstalled: repository.isInstalled,
    indexStatus: repository.indexStatus,
    defaultBranch: repository.defaultBranch ?? null,
    openPullRequests,
    lastReviewAt: lastReviewAt?.toISOString() ?? null,
  };
}

export function toPullRequestItem(
  pr: PullRequestView,
  latestRun: ReviewRunView | undefined,
): PullRequestItem {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    authorLogin: pr.authorLogin,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    headSha: pr.headSha,
    state: pr.state,
    isDraft: pr.isDraft,
    updatedAt: pr.updatedAt.toISOString(),
    latestRun: latestRun ? toRunSummary(latestRun) : null,
  };
}

export function pullRequestUrl(fullName: string, number: number): string {
  return `https://github.com/${fullName}/pull/${number}`;
}

export function toFindingItem(
  finding: FindingView,
  fullName: string,
  prNumber: number,
): FindingItem {
  const prUrl = pullRequestUrl(fullName, prNumber);
  return {
    id: finding.id,
    pass: finding.pass,
    severity: finding.severity,
    confidence: finding.confidence,
    category: finding.category,
    path: finding.path,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
    title: finding.title,
    body: finding.body,
    suggestion: finding.suggestion,
    state: finding.state,
    placement: finding.placement,
    githubUrl:
      finding.githubCommentId === undefined
        ? prUrl
        : `${prUrl}#discussion_r${finding.githubCommentId}`,
  };
}
