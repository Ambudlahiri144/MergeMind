import { parseRepoFullName, type GithubApp } from '@mergemind/github';
import {
  POLICY_FILE_PATH,
  ServiceUnavailableError,
  decodeCursor,
  encodeCursor,
  parsePolicy,
  type PageQuery,
  type PolicyResponse,
  type RepositoryItem,
} from '@mergemind/shared';

import type { AuthUser } from '../auth/api-token.js';
import { toRepositoryItem } from './mappers.js';
import type { ApiStores, ScopeService } from './scope.service.js';

export function requireGithub(github: GithubApp | null): GithubApp {
  if (github === null) {
    throw new ServiceUnavailableError('The GitHub App is not configured on the API');
  }
  return github;
}

export function createRepositoriesService(deps: {
  stores: ApiStores;
  scope: ScopeService;
  github: GithubApp | null;
}) {
  const { stores, scope } = deps;

  return {
    /** `GET /installations/:id/repositories`: by name, with open PRs and the last review. */
    async list(
      user: AuthUser,
      installationId: string,
      page: PageQuery,
    ): Promise<{ data: RepositoryItem[]; nextCursor: string | null }> {
      await scope.installation(user, installationId, 'member');
      const after = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
      const rows = await stores.repositories.listForInstallation(installationId, {
        limit: page.limit + 1,
        ...(after === undefined ? {} : { after: { fullName: String(after.k), id: after.id } }),
      });
      const pageRows = rows.slice(0, page.limit);
      const ids = pageRows.map((repository) => repository.id);
      const [openCounts, lastRuns] = await Promise.all([
        stores.pullRequests.countOpenByRepository(ids),
        stores.reviewRuns.lastRunAtByRepository(ids),
      ]);
      const last = pageRows.at(-1);
      return {
        data: pageRows.map((repository) =>
          toRepositoryItem(
            repository,
            openCounts.get(repository.id) ?? 0,
            lastRuns.get(repository.id),
          ),
        ),
        nextCursor:
          rows.length > page.limit && last ? encodeCursor({ k: last.fullName, id: last.id }) : null,
      };
    },

    /** `GET /repositories/:id`: one repository, as listed. */
    async get(user: AuthUser, repositoryId: string): Promise<RepositoryItem> {
      const { repository } = await scope.repository(user, repositoryId, 'member');
      const [openCounts, lastRuns] = await Promise.all([
        stores.pullRequests.countOpenByRepository([repository.id]),
        stores.reviewRuns.lastRunAtByRepository([repository.id]),
      ]);
      return toRepositoryItem(
        repository,
        openCounts.get(repository.id) ?? 0,
        lastRuns.get(repository.id),
      );
    },

    /** `GET /repositories/:id/policy`: `.mergemind.yml` on the default branch, as reviews read it. */
    async policy(user: AuthUser, repositoryId: string): Promise<PolicyResponse> {
      const { repository, installation } = await scope.repository(user, repositoryId, 'member');
      const client = await requireGithub(deps.github).forInstallation(
        installation.githubInstallationId,
      );
      const repoRef = parseRepoFullName(repository.fullName);
      const ref =
        repository.defaultBranch ?? (await client.getRepositoryInfo(repoRef)).defaultBranch;
      const text = await client.getFileText({ ...repoRef, path: POLICY_FILE_PATH, ref });
      const result = parsePolicy(text);
      return { ref, source: result.source, text, errors: result.errors, policy: result.policy };
    },
  };
}

export type RepositoriesService = ReturnType<typeof createRepositoriesService>;
