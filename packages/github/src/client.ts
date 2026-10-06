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
const MAX_JOB_PAGES = 3;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
/** Job logs above this keep only their tail (failures are reported at the end). */
export const MAX_JOB_LOG_CHARS = 10_000_000;

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
  /**
   * `base...head` comparison, or null when GitHub cannot compare them (404/422: no common
   * ancestor or a garbage-collected SHA after a force-push). `isTruncated` when the 300-file cap
   * may have cut the list.
   */
  compareCommits(input: RepoRef & { base: string; head: string }): Promise<CompareResult | null>;
  getBranchHead(input: RepoRef & { branch: string }): Promise<{ sha: string; treeSha: string }>;
  /** Default branch and visibility (installation payloads omit the branch). */
  getRepositoryInfo(input: RepoRef): Promise<{ defaultBranch: string; isPrivate: boolean }>;
  /** Blob entries of a recursive tree; submodules and directories are dropped. */
  getTree(input: RepoRef & { treeSha: string }): Promise<RepoTree>;
  getBlobText(input: RepoRef & { sha: string }): Promise<string>;
  /** Every review comment on the PR, replies included (for reply-marker dedupe). */
  listPullRequestComments(input: RepoRef & { pullNumber: number }): Promise<PullComment[]>;
  replyToReviewComment(
    input: RepoRef & { pullNumber: number; commentId: number; body: string },
  ): Promise<number>;
  /**
   * Resolves the review threads started by these comments. Apps reportedly need Contents: write
   * for this, so a permission refusal is reported (`isPermissionDenied`), not thrown (ADR-023).
   */
  resolveReviewThreads(
    input: RepoRef & { pullNumber: number; commentIds: readonly number[] },
  ): Promise<{ resolvedCount: number; isPermissionDenied: boolean }>;
  /** Jobs of one attempt of a workflow run (PRD F10; needs Actions: read). */
  listRunJobs(input: RepoRef & { runId: number; attempt: number }): Promise<WorkflowJob[]>;
  /**
   * A job's plain-text log, or null when it is gone (404/410: expired or deleted). Very large
   * logs keep only their tail, where failures are reported.
   */
  getJobLog(input: RepoRef & { jobId: number }): Promise<string | null>;
  /** PRs whose commits include `sha`; finds fork PRs, which `workflow_run` does not link. */
  listPullRequestsForCommit(input: RepoRef & { sha: string }): Promise<PullRequestRef[]>;
  getPullRequestState(input: RepoRef & { pullNumber: number }): Promise<PullRequestRef>;
  /** The PR conversation comment whose body contains `marker`, if any (ADR-028). */
  findIssueCommentByMarker(
    input: RepoRef & { issueNumber: number; marker: string },
  ): Promise<{ id: number; body: string } | null>;
  createIssueComment(input: RepoRef & { issueNumber: number; body: string }): Promise<number>;
  updateIssueComment(input: RepoRef & { commentId: number; body: string }): Promise<void>;
  /**
   * A user's membership of the installation's organisation, or null when they are not a
   * member (needs Organization -> Members: read; web UI access, ADR-030).
   */
  getOrgMembership(input: { org: string; username: string }): Promise<OrgMembership | null>;
};

export type OrgMembership = { role: 'admin' | 'member'; state: 'active' | 'pending' };

export type WorkflowJob = {
  id: number;
  name: string;
  conclusion: string | null;
  htmlUrl: string | null;
  steps: { name: string; number: number; conclusion: string | null }[];
};

export type PullRequestRef = { number: number; state: 'open' | 'closed'; headSha: string };

export const COMPARE_STATUSES = ['ahead', 'behind', 'diverged', 'identical'] as const;
export type CompareStatus = (typeof COMPARE_STATUSES)[number];

export type CompareResult = {
  status: CompareStatus;
  files: PullRequestFile[];
  isTruncated: boolean;
};

export type RepoTree = {
  entries: { path: string; sha: string; size: number }[];
  isTruncated: boolean;
};

export type PullComment = {
  id: number;
  body: string;
  inReplyToId: number | null;
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
  /**
   * Request pacing from @octokit/plugin-throttling (spaces content-creating requests ~3 s apart
   * to respect GitHub's secondary rate limits). Default true; tests against the fake turn it off.
   */
  isThrottled?: boolean;
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

    compareCommits: ({ owner, repo, base, head }) =>
      callGithub('compareCommits', async () => {
        try {
          const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
            owner,
            repo,
            basehead: `${base}...${head}`,
            per_page: COMPARE_FILE_CAP,
          });
          const files = (data.files ?? []).map(toPullRequestFile);
          return {
            status: data.status,
            files,
            isTruncated: files.length >= COMPARE_FILE_CAP,
          };
        } catch (error) {
          const status = statusOf(error);
          if (status === HTTP_NOT_FOUND || status === HTTP_UNPROCESSABLE) {
            return null;
          }
          throw error;
        }
      }),

    getBranchHead: ({ owner, repo, branch }) =>
      callGithub('getBranch', async () => {
        const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch });
        return { sha: data.commit.sha, treeSha: data.commit.commit.tree.sha };
      }),

    getRepositoryInfo: ({ owner, repo }) =>
      callGithub('getRepository', async () => {
        const { data } = await octokit.rest.repos.get({ owner, repo });
        return { defaultBranch: data.default_branch, isPrivate: data.private };
      }),

    getTree: ({ owner, repo, treeSha }) =>
      callGithub('getTree', async () => {
        const { data } = await octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: treeSha,
          recursive: 'true',
        });
        const entries = data.tree.flatMap((entry) =>
          entry.type === 'blob'
            ? [{ path: entry.path, sha: entry.sha, size: entry.size ?? 0 }]
            : [],
        );
        return { entries, isTruncated: data.truncated };
      }),

    getBlobText: ({ owner, repo, sha }) =>
      callGithub('getBlob', async () => {
        const { data } = await octokit.rest.git.getBlob({ owner, repo, file_sha: sha });
        return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString(
          'utf8',
        );
      }),

    listPullRequestComments: ({ owner, repo, pullNumber }) =>
      callGithub('listReviewComments', async () => {
        const comments: PullComment[] = [];
        for (let page = 1; page <= MAX_COMMENT_PAGES * 2; page += 1) {
          const { data } = await octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: PER_PAGE,
            page,
          });
          comments.push(
            ...data.map((comment) => ({
              id: comment.id,
              body: comment.body,
              inReplyToId: comment.in_reply_to_id ?? null,
            })),
          );
          if (data.length < PER_PAGE) {
            break;
          }
        }
        return comments;
      }),

    replyToReviewComment: ({ owner, repo, pullNumber, commentId, body }) =>
      callGithub('createReplyForReviewComment', async () => {
        const { data } = await octokit.rest.pulls.createReplyForReviewComment({
          owner,
          repo,
          pull_number: pullNumber,
          comment_id: commentId,
          body,
        });
        return data.id;
      }),

    listRunJobs: ({ owner, repo, runId, attempt }) =>
      callGithub('listJobsForWorkflowRunAttempt', async () => {
        const jobs: WorkflowJob[] = [];
        for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
          const { data } = await octokit.rest.actions.listJobsForWorkflowRunAttempt({
            owner,
            repo,
            run_id: runId,
            attempt_number: attempt,
            per_page: PER_PAGE,
            page,
          });
          jobs.push(
            ...data.jobs.map((job) => ({
              id: job.id,
              name: job.name,
              conclusion: job.conclusion,
              htmlUrl: job.html_url,
              steps: (job.steps ?? []).map((step) => ({
                name: step.name,
                number: step.number,
                conclusion: step.conclusion,
              })),
            })),
          );
          if (data.jobs.length < PER_PAGE) {
            break;
          }
        }
        return jobs;
      }),

    getJobLog: ({ owner, repo, jobId }) =>
      callGithub('downloadJobLogsForWorkflowRun', async () => {
        try {
          // 302 to a short-lived URL; fetch follows it (and drops our auth header cross-origin).
          const { data } = await octokit.request(
            'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
            {
              owner,
              repo,
              job_id: jobId,
            },
          );
          const text =
            typeof data === 'string'
              ? data
              : data instanceof ArrayBuffer
                ? new TextDecoder().decode(data)
                : '';
          return text.length > MAX_JOB_LOG_CHARS ? text.slice(-MAX_JOB_LOG_CHARS) : text;
        } catch (error) {
          const status = statusOf(error);
          if (status === HTTP_NOT_FOUND || status === HTTP_GONE) {
            return null;
          }
          throw error;
        }
      }),

    listPullRequestsForCommit: ({ owner, repo, sha }) =>
      callGithub('listPullRequestsAssociatedWithCommit', async () => {
        const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: sha,
          per_page: PER_PAGE,
        });
        return data.map((pr) => ({
          number: pr.number,
          state: pr.state === 'open' ? ('open' as const) : ('closed' as const),
          headSha: pr.head.sha,
        }));
      }),

    getPullRequestState: ({ owner, repo, pullNumber }) =>
      callGithub('getPullRequest', async () => {
        const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
        return {
          number: data.number,
          state: data.state === 'open' ? ('open' as const) : ('closed' as const),
          headSha: data.head.sha,
        };
      }),

    findIssueCommentByMarker: ({ owner, repo, issueNumber, marker }) =>
      callGithub('listIssueComments', async () => {
        for (let page = 1; page <= MAX_COMMENT_PAGES * 2; page += 1) {
          const { data } = await octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: issueNumber,
            per_page: PER_PAGE,
            page,
          });
          const match = data.find((comment) => comment.body?.includes(marker));
          if (match) {
            return { id: match.id, body: match.body ?? '' };
          }
          if (data.length < PER_PAGE) {
            break;
          }
        }
        return null;
      }),

    createIssueComment: ({ owner, repo, issueNumber, body }) =>
      callGithub('createIssueComment', async () => {
        const { data } = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body,
        });
        return data.id;
      }),

    updateIssueComment: ({ owner, repo, commentId, body }) =>
      callGithub('updateIssueComment', async () => {
        await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
      }),

    getOrgMembership: ({ org, username }) =>
      callGithub('getMembershipForUser', async () => {
        try {
          const { data } = await octokit.rest.orgs.getMembershipForUser({ org, username });
          return {
            role: data.role === 'admin' ? ('admin' as const) : ('member' as const),
            state: data.state === 'active' ? ('active' as const) : ('pending' as const),
          };
        } catch (error) {
          if (statusOf(error) === HTTP_NOT_FOUND) {
            return null;
          }
          throw error;
        }
      }),

    resolveReviewThreads: async ({ owner, repo, pullNumber, commentIds }) => {
      if (commentIds.length === 0) {
        return { resolvedCount: 0, isPermissionDenied: false };
      }
      const wanted = new Set(commentIds.map(String));
      try {
        const threadIds: string[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
          const result: ReviewThreadsQuery = await octokit.graphql(REVIEW_THREADS_QUERY, {
            owner,
            repo,
            number: pullNumber,
            cursor,
          });
          const threads = result.repository?.pullRequest?.reviewThreads;
          for (const thread of threads?.nodes ?? []) {
            const firstCommentId = thread.comments.nodes[0]?.fullDatabaseId;
            if (
              !thread.isResolved &&
              firstCommentId != null &&
              wanted.has(String(firstCommentId))
            ) {
              threadIds.push(thread.id);
            }
          }
          if (!threads?.pageInfo.hasNextPage) {
            break;
          }
          cursor = threads.pageInfo.endCursor;
        }
        for (const threadId of threadIds) {
          await octokit.graphql(RESOLVE_THREAD_MUTATION, { threadId });
        }
        return { resolvedCount: threadIds.length, isPermissionDenied: false };
      } catch (error) {
        if (isPermissionDenied(error)) {
          return { resolvedCount: 0, isPermissionDenied: true };
        }
        throw new UpstreamError('GitHub resolveReviewThread failed', 'github', { cause: error });
      }
    },
  };
}

const COMPARE_FILE_CAP = 300;
const HTTP_UNPROCESSABLE = 422;
const MAX_THREAD_PAGES = 5;

const REVIEW_THREADS_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id isResolved comments(first: 1) { nodes { fullDatabaseId } } }
        }
      }
    }
  }`;

const RESOLVE_THREAD_MUTATION = `
  mutation ($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
  }`;

type ReviewThreadsQuery = {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          isResolved: boolean;
          comments: { nodes: { fullDatabaseId: string | number | null }[] };
        }[];
      };
    } | null;
  } | null;
};

function isPermissionDenied(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /Resource not accessible by integration/i.test(text) || statusOf(error) === 403;
}

function toPullRequestFile(file: {
  filename: string;
  previous_filename?: string | undefined;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | undefined;
}): PullRequestFile {
  return {
    filename: file.filename,
    previous_filename: file.previous_filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
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
      enabled: options.isThrottled ?? true,
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
