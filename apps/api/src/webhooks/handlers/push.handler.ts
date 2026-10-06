import type { PushEvent } from '@mergemind/shared';

import type { IndexProducer } from '../../queues/index.producer.js';
import type { HandlerResult } from './handler-result.js';

/** A push to the default branch refreshes the code index (PRD F6); other pushes are ignored. */
export async function handlePush(
  event: PushEvent,
  deps: { indexProducer: IndexProducer },
): Promise<HandlerResult> {
  const { repository } = event;
  if (event.deleted) {
    return { status: 'ignored', reason: 'branch_deleted' };
  }
  if (event.ref !== `refs/heads/${repository.default_branch}`) {
    return { status: 'ignored', reason: 'not_default_branch' };
  }
  const jobId = await deps.indexProducer.enqueue({
    githubInstallationId: event.installation.id,
    githubRepoId: repository.id,
    repoFullName: repository.full_name,
    isPrivate: repository.private,
    defaultBranch: repository.default_branch,
    commitSha: event.after,
    trigger: 'push',
  });
  return { status: 'enqueued', reason: 'index_enqueued', jobId };
}
