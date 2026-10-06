import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  NotFoundError,
  type AcceptedResponse,
  type DismissFindingBody,
  type FindingStateResponse,
  type RepositoryItem,
} from '@mergemind/shared';

import type { AuthUser } from '../auth/api-token.js';
import type { IndexProducer } from '../queues/index.producer.js';
import type { ReviewProducer } from '../queues/review.producer.js';
import { toRepositoryItem } from './mappers.js';
import type { ApiStores, ScopeService } from './scope.service.js';

/**
 * Write endpoints (Architecture.md §5). Each checks the caller's role first: enabling a repo
 * and the budget are admin decisions; rerun, reindex and dismiss are open to members (ADR-030).
 */
export function createActionsService(deps: {
  stores: ApiStores;
  scope: ScopeService;
  reviewProducer: ReviewProducer;
  indexProducer: IndexProducer;
  now: () => Date;
}) {
  const { stores, scope } = deps;

  return {
    /** `PATCH /repositories/:id`: turn reviews on or off for one repository. */
    async setEnabled(
      user: AuthUser,
      repositoryId: string,
      isEnabled: boolean,
    ): Promise<RepositoryItem> {
      const { repository } = await scope.repository(user, repositoryId, 'admin');
      await stores.repositories.setEnabled(repository.id, isEnabled);
      const [openCounts, lastRuns] = await Promise.all([
        stores.pullRequests.countOpenByRepository([repository.id]),
        stores.reviewRuns.lastRunAtByRepository([repository.id]),
      ]);
      return toRepositoryItem(
        { ...repository, isEnabled },
        openCounts.get(repository.id) ?? 0,
        lastRuns.get(repository.id),
      );
    },

    /** `POST /repositories/:id/reindex`: a full pass over the default branch (ADR-031). */
    async reindex(user: AuthUser, repositoryId: string): Promise<AcceptedResponse> {
      const { repository, installation } = await scope.repository(user, repositoryId, 'member');
      if (!repository.isInstalled || !repository.isEnabled) {
        throw new ConflictError('Enable the repository before reindexing it');
      }
      if (repository.indexStatus === 'indexing') {
        throw new ConflictError('The repository is being indexed right now');
      }
      const jobId = await deps.indexProducer.enqueue({
        githubInstallationId: installation.githubInstallationId,
        githubRepoId: repository.githubRepoId,
        repoFullName: repository.fullName,
        isPrivate: repository.isPrivate,
        defaultBranch: repository.defaultBranch ?? null,
        commitSha: null,
        trigger: 'manual',
      });
      return { jobId };
    },

    /**
     * `POST /runs/:id/rerun`: review the PR's current head again as the next attempt, with a
     * new run, check run and review marker (ADR-031). Only the newest head of an open PR.
     */
    async rerun(user: AuthUser, runId: string): Promise<AcceptedResponse> {
      const { run, repository, installation } = await scope.run(user, runId, 'member');
      const pr = await stores.pullRequests.findById(run.pullRequestId);
      if (!pr) {
        throw new NotFoundError(`Pull request of run ${runId} not found`);
      }
      if (pr.state !== 'open') {
        throw new ConflictError('Only an open pull request can be reviewed again');
      }
      if (pr.headSha !== run.headSha) {
        throw new ConflictError('A newer commit was pushed; rerun the latest review instead');
      }
      if (repository.defaultBranch === undefined) {
        throw new ConflictError('The repository default branch is not known yet');
      }
      const attempt = (await stores.reviewRuns.maxAttempt(repository.id, pr.headSha)) + 1;
      const jobId = await deps.reviewProducer.enqueue({
        deliveryId: `manual-${randomUUID()}`,
        githubInstallationId: installation.githubInstallationId,
        githubRepoId: repository.githubRepoId,
        repoFullName: repository.fullName,
        isPrivate: repository.isPrivate,
        defaultBranch: repository.defaultBranch,
        prNumber: pr.number,
        title: pr.title,
        authorLogin: pr.authorLogin,
        baseRef: pr.baseRef,
        headRef: pr.headRef,
        baseSha: run.baseSha,
        headSha: pr.headSha,
        isDraft: pr.isDraft,
        trigger: 'manual',
        githubUpdatedAt: pr.githubUpdatedAt.toISOString(),
        attempt,
      });
      return { jobId };
    },

    /**
     * `PATCH /findings/:id`: dismiss a finding and suppress its fingerprint in the repository,
     * so it is never reported again (PRD F8). Idempotent; the gate updates on the next run.
     */
    async dismiss(
      user: AuthUser,
      findingId: string,
      body: DismissFindingBody,
    ): Promise<FindingStateResponse> {
      const { finding, repository } = await scope.finding(user, findingId, 'member');
      if (finding.state !== 'open' && finding.state !== 'dismissed') {
        throw new ConflictError(`A ${finding.state} finding cannot be dismissed`);
      }
      await stores.findings.dismiss(finding.id);
      await stores.suppressions.suppress({
        repositoryId: repository.id,
        fingerprint: finding.fingerprint,
        createdByLogin: user.login,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      });
      return { id: finding.id, state: 'dismissed' };
    },

    /** `PUT /installations/:id/budget`: the monthly token budget (admins and owners). */
    async setBudget(
      user: AuthUser,
      installationId: string,
      monthlyTokenBudget: number,
    ): Promise<{ monthlyTokenBudget: number }> {
      await scope.installation(user, installationId, 'admin');
      await stores.installations.setBudget(installationId, monthlyTokenBudget);
      return { monthlyTokenBudget };
    },
  };
}

export type ActionsService = ReturnType<typeof createActionsService>;
