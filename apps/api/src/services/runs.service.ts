import { parseRepoFullName, type GithubApp } from '@mergemind/github';
import { NotFoundError, type RunDetail, type SnippetResponse } from '@mergemind/shared';

import type { AuthUser } from '../auth/api-token.js';
import { toFindingItem, toRunSummary } from './mappers.js';
import { requireGithub } from './repositories.service.js';
import type { ApiStores, ScopeService } from './scope.service.js';

/** Context lines shown around a finding in the diff panel. */
export const SNIPPET_CONTEXT_LINES = 3;
const MAX_SNIPPET_LINES = 200;

export function createRunsService(deps: {
  stores: ApiStores;
  scope: ScopeService;
  github: GithubApp | null;
}) {
  const { stores, scope } = deps;

  return {
    /** `GET /runs/:id`: the run, its listed findings and whether it can be rerun. */
    async detail(user: AuthUser, runId: string): Promise<RunDetail> {
      const { run, repository } = await scope.run(user, runId, 'member');
      const [pr, findings] = await Promise.all([
        stores.pullRequests.findById(run.pullRequestId),
        stores.findings.listForRun(run.id),
      ]);
      if (!pr) {
        throw new NotFoundError(`Pull request of run ${runId} not found`);
      }
      const listed = findings.filter((finding) => finding.state !== 'filtered');
      return {
        ...toRunSummary(run),
        baseSha: run.baseSha,
        promptVersion: run.promptVersion,
        repository: { id: repository.id, fullName: repository.fullName },
        pullRequest: {
          id: pr.id,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          headSha: pr.headSha,
        },
        policyErrors: run.policyErrors,
        failedPasses: run.failedPasses,
        isBudgetWarning: run.isBudgetWarning,
        filteredCount: findings.length - listed.length,
        canRerun: pr.state === 'open' && pr.headSha === run.headSha,
        findings: listed.map((finding) => toFindingItem(finding, repository.fullName, pr.number)),
      };
    },

    /** `GET /findings/:id/snippet`: the flagged lines plus context, at the run's head. */
    async snippet(user: AuthUser, findingId: string): Promise<SnippetResponse> {
      const { finding, repository, installation } = await scope.finding(user, findingId, 'member');
      const run = await stores.reviewRuns.findById(finding.reviewRunId);
      if (!run) {
        throw new NotFoundError(`Review run of finding ${findingId} not found`);
      }
      const client = await requireGithub(deps.github).forInstallation(
        installation.githubInstallationId,
      );
      const text = await client.getFileText({
        ...parseRepoFullName(repository.fullName),
        path: finding.path,
        ref: run.headSha,
      });
      if (text === null) {
        throw new NotFoundError(`${finding.path} no longer exists at ${run.headSha.slice(0, 7)}`);
      }
      const all = text.split(/\r?\n/);
      const start = Math.max(1, finding.lineStart - SNIPPET_CONTEXT_LINES);
      const end = Math.min(
        all.length,
        finding.lineEnd + SNIPPET_CONTEXT_LINES,
        start + MAX_SNIPPET_LINES - 1,
      );
      return {
        path: finding.path,
        ref: run.headSha,
        highlight: { start: finding.lineStart, end: finding.lineEnd },
        lines: all
          .slice(start - 1, end)
          .map((line, index) => ({ number: start + index, text: line })),
      };
    },
  };
}

export type RunsService = ReturnType<typeof createRunsService>;
