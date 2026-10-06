import type { RepositoriesRepository } from '@mergemind/db';
import type { RepositoryEvent } from '@mergemind/shared';

import type { HandlerResult } from './handler-result.js';

/**
 * `publicized`, `privatized` and `renamed` carry the repo's new state. GitHub is authoritative
 * here, so this is the only webhook path that may make a repo public again (ADR-027).
 * One indexed update, no upsert (ADR-016).
 */
export async function handleRepositoryEvent(
  event: RepositoryEvent,
  deps: { repositories: RepositoriesRepository },
): Promise<HandlerResult> {
  const { repository } = event;
  const isTracked = await deps.repositories.updateFromGithub(repository.id, {
    fullName: repository.full_name,
    isPrivate: repository.private,
  });
  return isTracked
    ? { status: 'handled', reason: `repository_${event.action}` }
    : { status: 'ignored', reason: 'unknown_repository' };
}
