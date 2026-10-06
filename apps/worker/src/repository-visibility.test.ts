import type { RepositoryView } from '@mergemind/db';
import { describe, expect, it } from 'vitest';

import { escalateVisibility } from './repository-visibility.js';

const PUBLIC_REPO: RepositoryView = {
  id: 'repo-1',
  installationId: 'inst-1',
  githubRepoId: 77,
  fullName: 'acme/web',
  isPrivate: false,
  isInstalled: true,
  isEnabled: true,
  indexStatus: 'none',
};

function recordingRepositories() {
  const updates: { githubRepoId: number; changes: object }[] = [];
  return {
    updates,
    updateFromGithub: (githubRepoId: number, changes: object) => {
      updates.push({ githubRepoId, changes });
      return Promise.resolve(true);
    },
  };
}

describe('escalateVisibility (ADR-027)', () => {
  it('makes a public repo private when the job payload says private', async () => {
    const repositories = recordingRepositories();

    const result = await escalateVisibility(PUBLIC_REPO, true, repositories);

    expect(result.isPrivate).toBe(true);
    expect(repositories.updates).toEqual([{ githubRepoId: 77, changes: { isPrivate: true } }]);
  });

  it('never makes a private repo public from a (possibly stale) job payload', async () => {
    const repositories = recordingRepositories();
    const privateRepo = { ...PUBLIC_REPO, isPrivate: true };

    const result = await escalateVisibility(privateRepo, false, repositories);

    expect(result.isPrivate).toBe(true);
    expect(repositories.updates).toEqual([]);
  });

  it('writes nothing when the payload agrees', async () => {
    const repositories = recordingRepositories();

    await escalateVisibility(PUBLIC_REPO, false, repositories);

    expect(repositories.updates).toEqual([]);
  });
});
