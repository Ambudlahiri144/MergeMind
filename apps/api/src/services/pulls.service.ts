import {
  NotFoundError,
  decodeCursor,
  encodeCursor,
  type PullListQuery,
  type PullRequestDetail,
  type PullRequestItem,
} from '@mergemind/shared';

import type { AuthUser } from '../auth/api-token.js';
import { pullRequestUrl, toPullRequestItem, toRunSummary } from './mappers.js';
import type { ApiStores, ScopeService } from './scope.service.js';

/** Runs shown on a PR page; older ones are rarely useful and stay in the database. */
export const MAX_RUNS_PER_PR = 50;

export function createPullsService(deps: { stores: ApiStores; scope: ScopeService }) {
  const { stores, scope } = deps;

  return {
    /** `GET /repositories/:id/pulls`: newest update first, each with its latest run. */
    async list(
      user: AuthUser,
      repositoryId: string,
      query: PullListQuery,
    ): Promise<{ data: PullRequestItem[]; nextCursor: string | null }> {
      await scope.repository(user, repositoryId, 'member');
      const before = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const rows = await stores.pullRequests.listForRepository(repositoryId, {
        limit: query.limit + 1,
        ...(query.state === 'all' ? {} : { state: query.state }),
        ...(before === undefined
          ? {}
          : { before: { updatedAt: new Date(String(before.k)), id: before.id } }),
      });
      const pageRows = rows.slice(0, query.limit);
      const latest = await stores.reviewRuns.latestForPrs(pageRows.map((pr) => pr.id));
      const last = pageRows.at(-1);
      return {
        data: pageRows.map((pr) => toPullRequestItem(pr, latest.get(pr.id))),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ k: last.updatedAt.toISOString(), id: last.id })
            : null,
      };
    },

    /** `GET /repositories/:id/pulls/:number`: the PR and its run timeline. */
    async detail(user: AuthUser, repositoryId: string, number: number): Promise<PullRequestDetail> {
      const { repository } = await scope.repository(user, repositoryId, 'member');
      const pr = await stores.pullRequests.findByNumber(repositoryId, number);
      if (!pr) {
        throw new NotFoundError(`Pull request #${number} not found in ${repository.fullName}`);
      }
      const runs = await stores.reviewRuns.listForPr(pr.id, MAX_RUNS_PER_PR);
      const { latestRun: _latestRun, ...item } = toPullRequestItem(pr, undefined);
      return {
        ...item,
        repository: { id: repository.id, fullName: repository.fullName },
        htmlUrl: pullRequestUrl(repository.fullName, pr.number),
        runs: runs.map(toRunSummary),
      };
    },
  };
}

export type PullsService = ReturnType<typeof createPullsService>;
