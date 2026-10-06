import type { RepositoriesRepository, RepositoryView } from '@mergemind/db';

/**
 * Job payloads can be stale (a job queued before the repo went private may run after), so they
 * may only make a repo *more* private. Making it public again takes an authoritative source:
 * a `repository` webhook or a live GitHub read (ADR-027). Fails safe: Gemini stays excluded.
 */
export async function escalateVisibility(
  repository: RepositoryView,
  payloadIsPrivate: boolean,
  repositories: Pick<RepositoriesRepository, 'updateFromGithub'>,
): Promise<RepositoryView> {
  if (repository.isPrivate || !payloadIsPrivate) {
    return repository;
  }
  await repositories.updateFromGithub(repository.githubRepoId, { isPrivate: true });
  return { ...repository, isPrivate: true };
}
