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
  ];
  return fake;
}
