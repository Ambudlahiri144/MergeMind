import type { PullRequestsRepository, RepositoriesRepository } from '@mergemind/db';
import {
  buildReviewJobId,
  type PullRequestEvent,
  type PullRequestState,
  type ReviewPrJobData,
  type ReviewTrigger,
} from '@mergemind/shared';

import type { ReviewProducer } from '../../queues/review.producer.js';
import type { HandlerResult } from './handler-result.js';

export function toPullRequestState(
  pullRequest: PullRequestEvent['pull_request'],
): PullRequestState {
  if (pullRequest.state === 'open') {
    return 'open';
  }
  return pullRequest.merged === true ? 'merged' : 'closed';
}

export function toReviewJobData(
  event: PullRequestEvent,
  deliveryId: string,
  trigger: ReviewTrigger,
): ReviewPrJobData {
  const { pull_request: pr, repository } = event;
  return {
    deliveryId,
    githubInstallationId: event.installation.id,
    githubRepoId: repository.id,
    repoFullName: repository.full_name,
    isPrivate: repository.private,
    defaultBranch: repository.default_branch,
    prNumber: pr.number,
    title: pr.title,
    authorLogin: pr.user.login,
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    isDraft: pr.draft,
    trigger,
    githubUpdatedAt: pr.updated_at,
    attempt: 1,
  };
}

/** Enqueue only; drafts, budgets and policy are decided by the worker (Architecture.md §1). */
export async function handlePullRequestReview(
  event: PullRequestEvent,
  context: { deliveryId: string; trigger: ReviewTrigger },
  deps: { reviewProducer: ReviewProducer },
): Promise<HandlerResult> {
  const jobId = await deps.reviewProducer.enqueue(
    toReviewJobData(event, context.deliveryId, context.trigger),
  );
  return { status: 'enqueued', reason: 'review_enqueued', jobId };
}

export type PullRequestClosedDeps = {
  repositories: RepositoriesRepository;
  pullRequests: PullRequestsRepository;
  reviewProducer: ReviewProducer;
};

/** Records the closed/merged state and cancels a review that has not started yet. */
export async function handlePullRequestClosed(
  event: PullRequestEvent,
  deps: PullRequestClosedDeps,
): Promise<HandlerResult> {
  const { pull_request: pr, repository } = event;
  const jobRef = { githubRepoId: repository.id, prNumber: pr.number, headSha: pr.head.sha };
  // Either job may be waiting for this SHA: the regular one, or the ready_for_review one.
  const cancelled = await Promise.all([
    deps.reviewProducer.cancel(buildReviewJobId(jobRef)),
    deps.reviewProducer.cancel(buildReviewJobId({ ...jobRef, trigger: 'ready_for_review' })),
  ]);
  const isCancelled = cancelled.some(Boolean);

  // A repo we have never synced has no PR row to update; the next install sync creates it.
  const repositoryId = await deps.repositories.findIdByGithubRepoId(repository.id);
  if (repositoryId !== null) {
    await deps.pullRequests.upsertIfNewer({
      repositoryId,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.user.login,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      state: toPullRequestState(pr),
      isDraft: pr.draft,
      githubUpdatedAt: new Date(pr.updated_at),
    });
  }
  return {
    status: 'handled',
    reason: isCancelled ? 'pr_closed_review_cancelled' : 'pr_closed',
  };
}
