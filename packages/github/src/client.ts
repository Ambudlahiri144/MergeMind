import type { AccountType, GateConclusion } from '@mergemind/shared';
import { UpstreamError } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';
import { App } from '@octokit/app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';

import type { PullRequestFile } from './diff-parser.js';

export const CHECK_RUN_NAME = 'mergemind/review';
/** Every GitHub call is bounded (rules.md §6). */
export const GITHUB_TIMEOUT_MS = 15_000;
const PER_PAGE = 100;
/** listFiles returns at most 3,000 files (30 pages of 100). */
const MAX_FILE_PAGES = 30;
const MAX_REVIEW_PAGES = 10;
const MAX_COMMENT_PAGES = 5;
const HTTP_NOT_FOUND = 404;

const ReviewOctokit = Octokit.plugin(throttling, retry);
type ReviewOctokitInstance = InstanceType<typeof ReviewOctokit>;

/**
 * A fresh timeout per attempt. A single shared AbortSignal would stay aborted and make the retry
 * plugin's retries fail instantly.
 */
export function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

async function callGithub<T>(label: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const status = statusOf(error);
    throw new UpstreamError(
      `GitHub ${label} failed${status ? ` (HTTP ${status})` : ''}`,
      'github',
      {
        cause: error,
      },
    );
  }
}

export type RepoRef = { owner: string; repo: string };

export type InlineComment = {
  path: string;
  line: number;
  startLine?: number;
  body: string;
};

export type GithubInstallationClient = {
  /** File text at a ref, or null when the file does not exist there. */
  getFileText(input: RepoRef & { path: string; ref: string }): Promise<string | null>;
  listPullRequestFiles(input: RepoRef & { pullNumber: number }): Promise<PullRequestFile[]>;
  createCheckRun(input: RepoRef & { headSha: string; externalId: string }): Promise<number>;
  completeCheckRun(
    input: RepoRef & {
      checkRunId: number;
      conclusion: GateConclusion;
      title: string;
      summary: string;
    },
  ): Promise<void>;
  /** The id of an existing review whose body contains `marker`, if any (ADR-018). */
  findReviewByMarker(
    input: RepoRef & { pullNumber: number; marker: string },
  ): Promise<number | null>;
  createReview(
    input: RepoRef & {
      pullNumber: number;
      commitId: string;
      body: string;
      comments: readonly InlineComment[];
    },
  ): Promise<number>;
  listReviewComments(
    input: RepoRef & { pullNumber: number; reviewId: number },
  ): Promise<{ id: number; body: string }[]>;
};

export type GithubApp = {
  getInstallationAccount(installationId: number): Promise<{ login: string; type: AccountType }>;
  forInstallation(installationId: number): Promise<GithubInstallationClient>;
};

export type GithubAppOptions = {
  appId: number;
  /** PEM (PKCS#1 or PKCS#8). */
  privateKey: string;
  logger: Logger;
  /** Retries for 5xx and network errors; tests pass 0. Default 3. */
  retries?: number;
  timeoutMs?: number;
};

function createInstallationClient(octokit: ReviewOctokitInstance): GithubInstallationClient {
  return {
    getFileText: ({ owner, repo, path, ref }) =>
      callGithub('getContent', async () => {
        try {
          const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref,
            mediaType: { format: 'raw' },
          });
          const data: unknown = response.data;
          return typeof data === 'string' ? data : null;
        } catch (error) {
          if (statusOf(error) === HTTP_NOT_FOUND) {
            return null;
          }
          throw error;
        }
      }),

    listPullRequestFiles: ({ owner, repo, pullNumber }) =>
      callGithub('listFiles', async () => {
        const files: PullRequestFile[] = [];
        for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
          const { data } = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: PER_PAGE,
            page,
          });
          files.push(
            ...data.map((file) => ({
              filename: file.filename,
              previous_filename: file.previous_filename,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              patch: file.patch,
            })),
          );
          if (data.length < PER_PAGE) {
            break;
          }
        }
        return files;
      }),

    createCheckRun: ({ owner, repo, headSha, externalId }) =>
      callGithub('checks.create', async () => {
        const { data } = await octokit.rest.checks.create({
          owner,
          repo,
          name: CHECK_RUN_NAME,
          head_sha: headSha,
          status: 'in_progress',
          external_id: externalId,
          started_at: new Date().toISOString(),
        });
        return data.id;
      }),

    completeCheckRun: ({ owner, repo, checkRunId, conclusion, title, summary }) =>
      callGithub('checks.update', async () => {
        await octokit.rest.checks.update({
          owner,
          repo,
          check_run_id: checkRunId,
          status: 'completed',
          conclusion,
          completed_at: new Date().toISOString(),
          output: { title, summary },
        });
      }),

    findReviewByMarker: ({ owner, repo, pullNumber, marker }) =>
      callGithub('listReviews', async () => {
        for (let page = 1; page <= MAX_REVIEW_PAGES; page += 1) {
          const { data } = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: PER_PAGE,
            page,
          });
          const match = data.find((review) => review.body.includes(marker));
          if (match) {
            return match.id;
          }
          if (data.length < PER_PAGE) {
            break;
          }
        }
        return null;
      }),

    createReview: ({ owner, repo, pullNumber, commitId, body, comments }) =>
      callGithub('createReview', async () => {
        const { data } = await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: pullNumber,
          commit_id: commitId,
          event: 'COMMENT',
          body,
          comments: comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: 'RIGHT',
            body: comment.body,
            ...(comment.startLine === undefined
              ? {}
              : { start_line: comment.startLine, start_side: 'RIGHT' }),
          })),
        });
        return data.id;
      }),

    listReviewComments: ({ owner, repo, pullNumber, reviewId }) =>
      callGithub('listCommentsForReview', async () => {
        const comments: { id: number; body: string }[] = [];
        for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
          const { data } = await octokit.rest.pulls.listCommentsForReview({
            owner,
            repo,
            pull_number: pullNumber,
            review_id: reviewId,
            per_page: PER_PAGE,
            page,
          });
          comments.push(...data.map((comment) => ({ id: comment.id, body: comment.body })));
          if (data.length < PER_PAGE) {
            break;
          }
        }
        return comments;
      }),
  };
}

/**
 * GitHub App client (ADR-008). All installation clients share @octokit/app's token cache, so
 * `forInstallation` per job is cheap; tokens are re-minted lazily before they expire.
 */
export function createGithubApp(options: GithubAppOptions): GithubApp {
  const { logger } = options;
  const shouldRetryRateLimit =
    (kind: string) =>
    (
      retryAfter: number,
      request: { method: string; url: string },
      _octokit: unknown,
      retryCount: number,
    ) => {
      logger.warn(
        { kind, retryAfter, method: request.method, url: request.url, retryCount },
        'github.rateLimited',
      );
      return retryCount < 1;
    };

  const ConfiguredOctokit = ReviewOctokit.defaults({
    request: { fetch: createTimeoutFetch(options.timeoutMs ?? GITHUB_TIMEOUT_MS) },
    retry: { retries: options.retries ?? 3 },
    throttle: {
      onRateLimit: shouldRetryRateLimit('primary'),
      onSecondaryRateLimit: shouldRetryRateLimit('secondary'),
    },
  });
  const app = new App({
    appId: options.appId,
    privateKey: options.privateKey,
    Octokit: ConfiguredOctokit,
  });

  return {
    getInstallationAccount: (installationId) =>
      callGithub('getInstallation', async () => {
        const { data } = await app.octokit.request('GET /app/installations/{installation_id}', {
          installation_id: installationId,
        });
        const account = data.account;
        if (account === null || !('login' in account)) {
          throw new Error(`Installation ${installationId} has no user or organization account`);
        }
        return { login: account.login, type: account.type === 'User' ? 'User' : 'Organization' };
      }),

    async forInstallation(installationId) {
      const octokit = await app.getInstallationOctokit(installationId);
      return createInstallationClient(octokit);
    },
  };
}
