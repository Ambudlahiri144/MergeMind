import type {
  InstallationsRepository,
  PullRequestsRepository,
  RepositoriesRepository,
  ReviewRunsRepository,
} from '@mergemind/db';
import type { GithubApp } from '@mergemind/github';
import type { ReviewPrJobInput, ReviewRunStatus } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';

/**
 * Boot reconciliation (ADR-038). On a host whose Redis does not survive a restart, a queued or
 * running review job disappears with it, and GitHub's redelivery cannot bring it back (the
 * delivery is already recorded as enqueued). So after boot the worker looks for open PRs whose
 * current head has no finished review and enqueues them again. Job ids are deterministic
 * (ADR-017), so a job that did survive is not duplicated, and an interrupted run resumes
 * (ADR-018).
 */
export const RECONCILE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_RECONCILE_PULL_REQUESTS = 100;

const FINISHED: ReadonlySet<ReviewRunStatus> = new Set(['completed', 'failed']);

export type ReconcileDeps = {
  pullRequests: Pick<PullRequestsRepository, 'listOpenUpdatedSince'>;
  reviewRuns: Pick<ReviewRunsRepository, 'latestForPrs'>;
  repositories: Pick<RepositoriesRepository, 'findById'>;
  installations: Pick<InstallationsRepository, 'findById'>;
  github: Pick<GithubApp, 'forInstallation'>;
  enqueue(data: ReviewPrJobInput): Promise<string>;
  logger: Logger;
  now: () => Date;
};

export type ReconcileOutcome = { checked: number; enqueued: number; failed: number };

export async function reconcileReviews(deps: ReconcileDeps): Promise<ReconcileOutcome> {
  const since = new Date(deps.now().getTime() - RECONCILE_WINDOW_MS);
  const pulls = await deps.pullRequests.listOpenUpdatedSince(since, MAX_RECONCILE_PULL_REQUESTS);
  const latestRuns = await deps.reviewRuns.latestForPrs(pulls.map((pull) => pull.id));
  let enqueued = 0;
  let failed = 0;

  for (const pull of pulls) {
    const latest = latestRuns.get(pull.id);
    const isReviewed = (headSha: string) =>
      latest?.headSha === headSha && FINISHED.has(latest.status);
    if (pull.isDraft || isReviewed(pull.headSha)) {
      continue;
    }
    const repository = await deps.repositories.findById(pull.repositoryId);
    if (!repository?.isEnabled || !repository.isInstalled || !repository.defaultBranch) {
      continue;
    }
    const installation = await deps.installations.findById(repository.installationId);
    if (installation?.status !== 'active') {
      continue;
    }
    const [owner = '', repo = ''] = repository.fullName.split('/');
    try {
      // The stored row can be behind GitHub (the lost webhook may have been the newest push).
      const client = await deps.github.forInstallation(installation.githubInstallationId);
      const live = await client.getPullRequest({ owner, repo, pullNumber: pull.number });
      if (live.state !== 'open' || live.isDraft || isReviewed(live.headSha)) {
        continue;
      }
      // An unfinished run at this head (lost mid-review) resumes as the same attempt.
      const attempt = latest?.headSha === live.headSha ? latest.attempt : 1;
      const isIncremental =
        pull.lastReviewedSha !== undefined && pull.lastReviewedSha !== live.headSha;
      const jobId = await deps.enqueue({
        deliveryId: `reconcile-${live.headSha}`,
        githubInstallationId: installation.githubInstallationId,
        githubRepoId: repository.githubRepoId,
        repoFullName: repository.fullName,
        isPrivate: repository.isPrivate,
        defaultBranch: repository.defaultBranch,
        prNumber: live.number,
        title: live.title,
        authorLogin: live.authorLogin,
        baseRef: live.baseRef,
        headRef: live.headRef,
        baseSha: live.baseSha,
        headSha: live.headSha,
        isDraft: false,
        trigger: attempt > 1 ? 'manual' : isIncremental ? 'synchronize' : 'opened',
        githubUpdatedAt: live.updatedAt.toISOString(),
        attempt,
      });
      enqueued += 1;
      deps.logger.info({ jobId, repo: repository.fullName, pr: live.number }, 'reconcile.enqueued');
    } catch (error) {
      // One unreachable PR must not stop the pass; it is logged and counted.
      failed += 1;
      deps.logger.warn(
        { err: error, repo: repository.fullName, pr: pull.number },
        'reconcile.pullFailed',
      );
    }
  }

  const outcome = { checked: pulls.length, enqueued, failed };
  deps.logger.info(outcome, 'reconcile.pass');
  return outcome;
}
