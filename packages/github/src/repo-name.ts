import { ValidationError } from '@mergemind/shared';

export type RepoCoordinates = {
  owner: string;
  repo: string;
};

// GitHub owner and repository names: letters, digits, '-', '_' and '.'.
const REPO_FULL_NAME_PATTERN = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

/** Splits `owner/name` (Architecture.md §4 `repositories.fullName`) into Octokit parameters. */
export function parseRepoFullName(fullName: string): RepoCoordinates {
  const match = REPO_FULL_NAME_PATTERN.exec(fullName);
  const [, owner, repo] = match ?? [];
  if (owner === undefined || repo === undefined) {
    throw new ValidationError(`Invalid repository full name: ${fullName}`);
  }
  return { owner, repo };
}
