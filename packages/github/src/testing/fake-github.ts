import { generateKeyPairSync } from 'node:crypto';

import { HttpResponse, http, type HttpHandler } from 'msw';

import { commentableLines, toFileDiff, type PullRequestFile } from '../diff-parser.js';

// In-memory GitHub REST fake for MSW (Testing.md §2: MSW for all outbound HTTP).
// Test-only; never import from production code.

const API = 'https://api.github.com';
const TOKEN_TTL_MS = 60 * 60_000;
const HTTP_UNPROCESSABLE = 422;

/** An RSA key in PKCS#8 PEM that @octokit/auth-app can sign app JWTs with. */
export function createTestPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey;
}

export type FakeCheckRun = {
  id: number;
  repo: string;
  headSha: string;
  externalId: string;
  status: string;
  conclusion?: string;
  output?: { title: string; summary: string };
};

export type FakeReviewComment = {
  id: number;
  path: string;
  line: number;
  start_line?: number;
  body: string;
};

export type FakeReview = {
  id: number;
  repo: string;
  pullNumber: number;
  commitId: string;
  body: string;
  comments: FakeReviewComment[];
};

type Fault = { method: string; pattern: RegExp; status: number; remaining: number };

type ReviewRequestBody = {
  commit_id: string;
  body: string;
  comments?: { path: string; line: number; start_line?: number; body: string }[];
};

export type FakeJob = {
  id: number;
  name: string;
  conclusion: string | null;
  html_url: string;
  steps: { name: string; number: number; conclusion: string | null }[];
};

export type FakeIssueComment = {
  id: number;
  repo: string;
  issueNumber: number;
  body: string;
  editCount: number;
};

export type FakeGithub = {
  handlers: HttpHandler[];
  /** `owner/repo#number` → files returned by listFiles. */
  pullRequestFiles: Map<string, PullRequestFile[]>;
  /** `owner/repo@ref:path` → raw file text. */
  fileContents: Map<string, string>;
  installations: Map<number, { login: string; type: 'User' | 'Organization' }>;
  checkRuns: FakeCheckRun[];
  reviews: FakeReview[];
  tokensMinted: number;
  requests: { method: string; path: string }[];
  /** `owner/repo:base...head` → compare result; a missing key answers 404 (force-push). */
  compares: Map<string, { status: string; files: PullRequestFile[] }>;
  /** `owner/repo` → repository metadata. */
  repoInfo: Map<string, { defaultBranch: string; isPrivate: boolean }>;
  /** `owner/repo:branch` → head commit and its tree. */
  branches: Map<string, { sha: string; treeSha: string }>;
  /** `owner/repo:treeSha` → recursive tree. */
  trees: Map<
    string,
    { entries: { path: string; sha: string; size: number }[]; truncated?: boolean }
  >;
  /** `owner/repo:blobSha` → file text (served base64 like GitHub). */
  blobs: Map<string, string>;
  /** Replies posted to review comments. */
  replies: { id: number; repo: string; pullNumber: number; inReplyToId: number; body: string }[];
  /** Thread ids (`thread-<firstCommentId>`) resolved through GraphQL. */
  resolvedThreads: Set<string>;
  /** Simulate GitHub refusing resolveReviewThread without Contents: write. */
  isThreadResolveForbidden: boolean;
  /** `owner/repo:runId@attempt` → jobs of that run attempt. */
  runJobs: Map<string, FakeJob[]>;
  /** `owner/repo:jobId` → plain-text job log; a missing key answers 404 (expired). */
  jobLogs: Map<string, string>;
  /** `owner/repo:sha` → PRs whose commits include it. */
  commitPulls: Map<string, { number: number; state: 'open' | 'closed'; headSha: string }[]>;
  /** `owner/repo#number` → PR state; a missing key answers 404. */
  pullStates: Map<string, { state: 'open' | 'closed'; headSha: string }>;
  /** PR conversation comments (issue comments), with how often each was edited. */
  issueComments: FakeIssueComment[];
  /** `org:username` -> membership; a missing key answers 404 (not a member). */
  orgMemberships: Map<string, { role: 'admin' | 'member'; state: 'active' | 'pending' }>;
  /** Make the next `times` requests matching method + path regex fail with `status`. */
  failNext(method: string, pattern: RegExp, status: number, times?: number): void;
  reset(): void;
};

export function createFakeGithub(): FakeGithub {
  let nextId = 1000;
  const faults: Fault[] = [];

  const fake: FakeGithub = {
    handlers: [],
    pullRequestFiles: new Map(),
    fileContents: new Map(),
    installations: new Map(),
    checkRuns: [],
    reviews: [],
    tokensMinted: 0,
    requests: [],
    compares: new Map(),
    branches: new Map(),
    repoInfo: new Map(),
    trees: new Map(),
    blobs: new Map(),
    replies: [],
    resolvedThreads: new Set(),
    isThreadResolveForbidden: false,
    runJobs: new Map(),
    jobLogs: new Map(),
    commitPulls: new Map(),
    pullStates: new Map(),
    issueComments: [],
    orgMemberships: new Map(),
    failNext(method, pattern, status, times = 1) {
      faults.push({ method, pattern, status, remaining: times });
    },
    reset() {
      fake.pullRequestFiles.clear();
      fake.fileContents.clear();
      fake.installations.clear();
      fake.checkRuns.length = 0;
      fake.reviews.length = 0;
      fake.requests.length = 0;
      fake.tokensMinted = 0;
      fake.compares.clear();
      fake.branches.clear();
      fake.repoInfo.clear();
      fake.trees.clear();
      fake.blobs.clear();
      fake.replies.length = 0;
      fake.resolvedThreads.clear();
      fake.isThreadResolveForbidden = false;
      fake.runJobs.clear();
      fake.jobLogs.clear();
      fake.commitPulls.clear();
      fake.pullStates.clear();
      fake.issueComments.length = 0;
      fake.orgMemberships.clear();
      faults.length = 0;
    },
  };

  const recorder = http.all(`${API}/*`, ({ request }) => {
    const path = new URL(request.url).pathname;
    fake.requests.push({ method: request.method, path });
    const fault = faults.find(
      (candidate) =>
        candidate.remaining > 0 &&
        candidate.method === request.method &&
        candidate.pattern.test(path),
    );
    if (fault) {
      fault.remaining -= 1;
      return HttpResponse.json({ message: 'Injected fault' }, { status: fault.status });
    }
    // Fall through to the specific handler below.
    return undefined;
  });

  fake.handlers = [
    recorder,

    http.post(`${API}/app/installations/:id/access_tokens`, () => {
      fake.tokensMinted += 1;
      return HttpResponse.json(
        {
          token: `ghs_fake_${fake.tokensMinted}`,
          expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
          permissions: {},
          repository_selection: 'all',
        },
        { status: 201 },
      );
    }),

    http.get(`${API}/app/installations/:id`, ({ params }) => {
      const account = fake.installations.get(Number(params.id));
      return account
        ? HttpResponse.json({ id: Number(params.id), account: { ...account, id: 1 } })
        : HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    }),

    http.get(`${API}/repos/:owner/:repo/contents/*`, ({ request, params }) => {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '');
      const key = `${String(params.owner)}/${String(params.repo)}@${url.searchParams.get('ref') ?? ''}:${path}`;
      const text = fake.fileContents.get(key);
      return text === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        : HttpResponse.text(text);
    }),

    http.get(`${API}/repos/:owner/:repo/pulls/:number/files`, ({ request, params }) => {
      const url = new URL(request.url);
      const perPage = Number(url.searchParams.get('per_page') ?? '30');
      const page = Number(url.searchParams.get('page') ?? '1');
      const files =
        fake.pullRequestFiles.get(
          `${String(params.owner)}/${String(params.repo)}#${String(params.number)}`,
        ) ?? [];
      return HttpResponse.json(files.slice((page - 1) * perPage, page * perPage));
    }),

    http.post(`${API}/repos/:owner/:repo/check-runs`, async ({ request, params }) => {
      const body = (await request.json()) as {
        head_sha: string;
        external_id: string;
        status: string;
      };
      const checkRun: FakeCheckRun = {
        id: (nextId += 1),
        repo: `${String(params.owner)}/${String(params.repo)}`,
        headSha: body.head_sha,
        externalId: body.external_id,
        status: body.status,
      };
      fake.checkRuns.push(checkRun);
      return HttpResponse.json({ id: checkRun.id }, { status: 201 });
    }),

    http.patch(`${API}/repos/:owner/:repo/check-runs/:id`, async ({ request, params }) => {
      const checkRun = fake.checkRuns.find((candidate) => candidate.id === Number(params.id));
      if (!checkRun) {
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }
      const body = (await request.json()) as {
        status: string;
        conclusion: string;
        output: { title: string; summary: string };
      };
      Object.assign(checkRun, {
        status: body.status,
        conclusion: body.conclusion,
        output: body.output,
      });
      return HttpResponse.json({ id: checkRun.id });
    }),

    http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews`, ({ request, params }) => {
      const url = new URL(request.url);
      const perPage = Number(url.searchParams.get('per_page') ?? '30');
      const page = Number(url.searchParams.get('page') ?? '1');
      const repo = `${String(params.owner)}/${String(params.repo)}`;
      const reviews = fake.reviews
        .filter((review) => review.repo === repo && review.pullNumber === Number(params.number))
        .map((review) => ({ id: review.id, body: review.body, commit_id: review.commitId }));
      return HttpResponse.json(reviews.slice((page - 1) * perPage, page * perPage));
    }),

    http.post(`${API}/repos/:owner/:repo/pulls/:number/reviews`, async ({ request, params }) => {
      const body = (await request.json()) as ReviewRequestBody;
      const repo = `${String(params.owner)}/${String(params.repo)}`;
      const files = fake.pullRequestFiles.get(`${repo}#${String(params.number)}`) ?? [];
      const comments = body.comments ?? [];
      // Like GitHub: one comment off the diff rejects the whole review.
      for (const comment of comments) {
        const file = files.find((candidate) => candidate.filename === comment.path);
        const lines = file ? commentableLines(toFileDiff(file)) : new Map<number, number>();
        const isOnDiff =
          lines.has(comment.line) &&
          (comment.start_line === undefined ||
            lines.get(comment.start_line) === lines.get(comment.line));
        if (!isOnDiff) {
          return HttpResponse.json(
            { message: 'Unprocessable Entity', errors: ['Line could not be resolved'] },
            { status: HTTP_UNPROCESSABLE },
          );
        }
      }
      const review: FakeReview = {
        id: (nextId += 1),
        repo,
        pullNumber: Number(params.number),
        commitId: body.commit_id,
        body: body.body,
        comments: comments.map((comment) => ({ ...comment, id: (nextId += 1) })),
      };
      fake.reviews.push(review);
      return HttpResponse.json({ id: review.id, body: review.body });
    }),

    http.get(`${API}/repos/:owner/:repo/pulls/:number/reviews/:reviewId/comments`, ({ params }) => {
      const review = fake.reviews.find((candidate) => candidate.id === Number(params.reviewId));
      return HttpResponse.json(review?.comments ?? []);
    }),

    http.get(`${API}/repos/:owner/:repo/compare/:basehead`, ({ params }) => {
      const repo = `${String(params.owner)}/${String(params.repo)}`;
      const compare = fake.compares.get(`${repo}:${String(params.basehead)}`);
      return compare
        ? HttpResponse.json({ status: compare.status, files: compare.files })
        : HttpResponse.json({ message: 'No common ancestor between the commits' }, { status: 404 });
    }),

    http.get(`${API}/repos/:owner/:repo`, ({ params }) => {
      const info = fake.repoInfo.get(`${String(params.owner)}/${String(params.repo)}`);
      return info
        ? HttpResponse.json({ default_branch: info.defaultBranch, private: info.isPrivate })
        : HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    }),

    http.get(`${API}/repos/:owner/:repo/branches/:branch`, ({ params }) => {
      const head = fake.branches.get(
        `${String(params.owner)}/${String(params.repo)}:${String(params.branch)}`,
      );
      return head
        ? HttpResponse.json({
            name: params.branch,
            commit: { sha: head.sha, commit: { tree: { sha: head.treeSha } } },
          })
        : HttpResponse.json({ message: 'Branch not found' }, { status: 404 });
    }),

    http.get(`${API}/repos/:owner/:repo/git/trees/:treeSha`, ({ params }) => {
      const tree = fake.trees.get(
        `${String(params.owner)}/${String(params.repo)}:${String(params.treeSha)}`,
      );
      if (!tree) {
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }
      return HttpResponse.json({
        sha: params.treeSha,
        truncated: tree.truncated ?? false,
        tree: tree.entries.map((entry) => ({ ...entry, mode: '100644', type: 'blob' })),
      });
    }),

    http.get(`${API}/repos/:owner/:repo/git/blobs/:sha`, ({ params }) => {
      const text = fake.blobs.get(
        `${String(params.owner)}/${String(params.repo)}:${String(params.sha)}`,
      );
      return text === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        : HttpResponse.json({
            sha: params.sha,
            encoding: 'base64',
            content: Buffer.from(text).toString('base64'),
          });
    }),

    http.get(`${API}/repos/:owner/:repo/pulls/:number/comments`, ({ params }) => {
      const repo = `${String(params.owner)}/${String(params.repo)}`;
      const pullNumber = Number(params.number);
      const topLevel = fake.reviews
        .filter((review) => review.repo === repo && review.pullNumber === pullNumber)
        .flatMap((review) =>
          review.comments.map((comment) => ({
            id: comment.id,
            body: comment.body,
            in_reply_to_id: null,
          })),
        );
      const replies = fake.replies
        .filter((reply) => reply.repo === repo && reply.pullNumber === pullNumber)
        .map((reply) => ({ id: reply.id, body: reply.body, in_reply_to_id: reply.inReplyToId }));
      return HttpResponse.json([...topLevel, ...replies]);
    }),

    http.post(
      `${API}/repos/:owner/:repo/pulls/:number/comments/:commentId/replies`,
      async ({ request, params }) => {
        const body = (await request.json()) as { body: string };
        const reply = {
          id: (nextId += 1),
          repo: `${String(params.owner)}/${String(params.repo)}`,
          pullNumber: Number(params.number),
          inReplyToId: Number(params.commentId),
          body: body.body,
        };
        fake.replies.push(reply);
        return HttpResponse.json(
          { id: reply.id, body: reply.body, in_reply_to_id: reply.inReplyToId },
          { status: 201 },
        );
      },
    ),

    http.post(`${API}/graphql`, async ({ request }) => {
      const { query, variables } = (await request.json()) as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (query.includes('resolveReviewThread')) {
        if (fake.isThreadResolveForbidden) {
          return HttpResponse.json({
            data: { resolveReviewThread: null },
            errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
          });
        }
        const threadId = String(variables.threadId);
        fake.resolvedThreads.add(threadId);
        return HttpResponse.json({
          data: { resolveReviewThread: { thread: { id: threadId, isResolved: true } } },
        });
      }
      const repo = `${String(variables.owner)}/${String(variables.repo)}`;
      const nodes = fake.reviews
        .filter((review) => review.repo === repo && review.pullNumber === Number(variables.number))
        .flatMap((review) => review.comments)
        .map((comment) => ({
          id: `thread-${comment.id}`,
          isResolved: fake.resolvedThreads.has(`thread-${comment.id}`),
          comments: { nodes: [{ fullDatabaseId: String(comment.id) }] },
        }));
      return HttpResponse.json({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
            },
          },
        },
      });
    }),

    http.get(
      `${API}/repos/:owner/:repo/actions/runs/:runId/attempts/:attempt/jobs`,
      ({ params, request }) => {
        const repo = `${String(params.owner)}/${String(params.repo)}`;
        const jobs = fake.runJobs.get(`${repo}:${String(params.runId)}@${String(params.attempt)}`);
        const page = paginate(jobs ?? [], new URL(request.url));
        return HttpResponse.json({ total_count: jobs?.length ?? 0, jobs: page });
      },
    ),

    http.get(`${API}/repos/:owner/:repo/actions/jobs/:jobId/logs`, ({ params }) => {
      const log = fake.jobLogs.get(
        `${String(params.owner)}/${String(params.repo)}:${String(params.jobId)}`,
      );
      // GitHub answers 302 to blob storage; serving the text directly keeps MSW to one host.
      return log === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        : HttpResponse.text(log);
    }),

    http.get(`${API}/repos/:owner/:repo/commits/:sha/pulls`, ({ params }) => {
      const pulls =
        fake.commitPulls.get(
          `${String(params.owner)}/${String(params.repo)}:${String(params.sha)}`,
        ) ?? [];
      return HttpResponse.json(
        pulls.map((pr) => ({ number: pr.number, state: pr.state, head: { sha: pr.headSha } })),
      );
    }),

    http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ params }) => {
      const state = fake.pullStates.get(
        `${String(params.owner)}/${String(params.repo)}#${String(params.number)}`,
      );
      return state === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        : HttpResponse.json({
            number: Number(params.number),
            state: state.state,
            head: { sha: state.headSha },
          });
    }),

    http.get(`${API}/orgs/:org/memberships/:username`, ({ params }) => {
      const membership = fake.orgMemberships.get(
        `${String(params.org)}:${String(params.username)}`,
      );
      return membership === undefined
        ? HttpResponse.json({ message: 'Not Found' }, { status: 404 })
        : HttpResponse.json({ ...membership, organization: { login: String(params.org) } });
    }),

    http.get(`${API}/repos/:owner/:repo/issues/:number/comments`, ({ params, request }) => {
      const repo = `${String(params.owner)}/${String(params.repo)}`;
      const comments = fake.issueComments.filter(
        (comment) => comment.repo === repo && comment.issueNumber === Number(params.number),
      );
      return HttpResponse.json(
        paginate(comments, new URL(request.url)).map((comment) => ({
          id: comment.id,
          body: comment.body,
        })),
      );
    }),

    http.post(`${API}/repos/:owner/:repo/issues/:number/comments`, async ({ params, request }) => {
      const body = (await request.json()) as { body: string };
      const comment: FakeIssueComment = {
        id: (nextId += 1),
        repo: `${String(params.owner)}/${String(params.repo)}`,
        issueNumber: Number(params.number),
        body: body.body,
        editCount: 0,
      };
      fake.issueComments.push(comment);
      return HttpResponse.json({ id: comment.id, body: comment.body }, { status: 201 });
    }),

    http.patch(
      `${API}/repos/:owner/:repo/issues/comments/:commentId`,
      async ({ params, request }) => {
        const comment = fake.issueComments.find((c) => c.id === Number(params.commentId));
        if (!comment) {
          return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
        }
        comment.body = ((await request.json()) as { body: string }).body;
        comment.editCount += 1;
        return HttpResponse.json({ id: comment.id, body: comment.body });
      },
    ),
  ];
  return fake;
}

/** GitHub-style `per_page` / `page` slicing (defaults 30 / 1). */
function paginate<T>(items: readonly T[], url: URL): T[] {
  const perPage = Number(url.searchParams.get('per_page') ?? '30');
  const page = Number(url.searchParams.get('page') ?? '1');
  return items.slice((page - 1) * perPage, page * perPage);
}
