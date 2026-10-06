import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createFindingsRepository,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  createUsageLedgerRepository,
  disconnectMongo,
  ensureDbIndexes,
  type NewFinding,
} from '@mergemind/db';
import { createFakeGithub } from '@mergemind/github/testing';
import {
  PolicyResponseSchema,
  PullRequestDetailSchema,
  PullRequestPageSchema,
  RepositoryPageSchema,
  RunDetailSchema,
  SnippetResponseSchema,
  UsageResponseSchema,
  usagePeriod,
} from '@mergemind/shared';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from 'vitest';

import { buildApiApp, createTestGithub, failOnExternalRequests } from '../support/api-app.js';
import { signTestToken } from '../support/api-token.js';

const fakeGithub = createFakeGithub();
const server = setupServer(...fakeGithub.handlers);
const github = createTestGithub();
const installations = createInstallationsRepository();
const repositories = createRepositoriesRepository();
const pullRequests = createPullRequestsRepository();
const runs = createReviewRunsRepository();
const findings = createFindingsRepository();
const usage = createUsageLedgerRepository();
const NOW = new Date('2026-10-06T12:00:00Z');
const LOGIN = 'ananya-iyer';
const HEAD = 'a'.repeat(40);

let redis: Redis;
let app: ReturnType<typeof buildApiApp>;
let token: string;
const seeded = {
  installationId: '',
  foreignInstallationId: '',
  repositoryId: '',
  secondRepositoryId: '',
  foreignRepositoryId: '',
  prId: '',
  runId: '',
  findingId: '',
};

const FINDING: NewFinding = {
  pass: 'security',
  severity: 'critical',
  confidence: 0.95,
  category: 'hardcoded-secret',
  path: 'src/pay.ts',
  lineStart: 3,
  lineEnd: 3,
  title: 'Live key in source',
  body: 'A live API key is committed.',
  suggestion: null,
  fingerprint: 'c'.repeat(64),
  state: 'open',
  placement: 'inline',
};

async function seed() {
  seeded.installationId = await installations.upsertFromGithub({
    githubInstallationId: 810_001,
    accountLogin: LOGIN,
    accountType: 'User',
    status: 'active',
  });
  seeded.foreignInstallationId = await installations.upsertFromGithub({
    githubInstallationId: 810_002,
    accountLogin: 'octo-strangers',
    accountType: 'Organization',
    status: 'active',
  });
  seeded.repositoryId = await repositories.upsertForInstallation(seeded.installationId, {
    githubRepoId: 820_001,
    fullName: `${LOGIN}/payments`,
    isPrivate: false,
    defaultBranch: 'main',
  });
  seeded.secondRepositoryId = await repositories.upsertForInstallation(seeded.installationId, {
    githubRepoId: 820_002,
    fullName: `${LOGIN}/website`,
    isPrivate: false,
  });
  seeded.foreignRepositoryId = await repositories.upsertForInstallation(
    seeded.foreignInstallationId,
    { githubRepoId: 820_003, fullName: 'octo-strangers/secret', isPrivate: true },
  );
  for (const [number, state] of [
    [1, 'closed'],
    [2, 'open'],
  ] as const) {
    await pullRequests.upsertIfNewer({
      repositoryId: seeded.repositoryId,
      number,
      title: `Refund fix ${number}`,
      authorLogin: 'rohan-mehta',
      baseRef: 'main',
      headRef: `fix-${number}`,
      headSha: HEAD,
      state,
      isDraft: false,
      githubUpdatedAt: NOW,
    });
  }
  const pr = await pullRequests.findByNumber(seeded.repositoryId, 2);
  seeded.prId = pr?.id ?? '';
  const { run } = await runs.startOrResume({
    repositoryId: seeded.repositoryId,
    pullRequestId: seeded.prId,
    headSha: HEAD,
    baseSha: 'b'.repeat(40),
    trigger: 'opened',
    attempt: 1,
    promptVersion: 'security@2',
  });
  seeded.runId = run.id;
  await findings.insertForRun(
    { reviewRunId: run.id, pullRequestId: seeded.prId, repositoryId: seeded.repositoryId },
    [FINDING, { ...FINDING, fingerprint: 'd'.repeat(64), state: 'filtered', confidence: 0.3 }],
  );
  await findings.setCommentIds(run.id, [{ fingerprint: FINDING.fingerprint, githubCommentId: 77 }]);
  const listed = await findings.listForRun(run.id);
  seeded.findingId = listed.find((finding) => finding.state === 'open')?.id ?? '';
  await usage.record([
    {
      installationId: seeded.installationId,
      kind: 'review',
      provider: 'groq',
      model: 'm',
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 1,
      isFallback: false,
      period: usagePeriod(NOW),
    },
    {
      installationId: seeded.installationId,
      kind: 'ci_summary',
      provider: 'groq',
      model: 'm',
      inputTokens: 300,
      outputTokens: 50,
      latencyMs: 1,
      isFallback: false,
      period: usagePeriod(NOW),
    },
  ]);
}

const get = (path: string) =>
  request(app).get(`/api/v1${path}`).set('authorization', `Bearer ${token}`);

beforeAll(async () => {
  server.listen(failOnExternalRequests);
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
  redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
  app = buildApiApp({ redis, github, now: () => NOW });
  token = await signTestToken({ githubUserId: 4001, login: LOGIN });
  await seed();
});

afterEach(() => {
  fakeGithub.reset();
});

afterAll(async () => {
  server.close();
  await redis.quit();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('GET /installations/:id/repositories', () => {
  it('pages repositories by name with open PRs and the last review', async () => {
    const first = await get(`/installations/${seeded.installationId}/repositories?limit=1`);
    const firstPage = RepositoryPageSchema.parse(first.body);
    const second = await get(
      `/installations/${seeded.installationId}/repositories?limit=1&cursor=${firstPage.nextCursor ?? ''}`,
    );
    const secondPage = RepositoryPageSchema.parse(second.body);

    expect(firstPage.data[0]).toMatchObject({
      fullName: `${LOGIN}/payments`,
      openPullRequests: 1,
      lastReviewAt: expect.any(String) as unknown,
    });
    expect(secondPage.data.map((repo) => repo.fullName)).toEqual([`${LOGIN}/website`]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('answers 403 for an installation the user cannot see, 404 for none, 400 for junk', async () => {
    const foreign = await get(`/installations/${seeded.foreignInstallationId}/repositories`);
    const missing = await get(`/installations/${'0'.repeat(24)}/repositories`);
    const badId = await get('/installations/not-an-id/repositories');
    const badCursor = await get(`/installations/${seeded.installationId}/repositories?cursor=zzz`);
    const badLimit = await get(`/installations/${seeded.installationId}/repositories?limit=500`);

    expect([
      foreign.status,
      missing.status,
      badId.status,
      badCursor.status,
      badLimit.status,
    ]).toEqual([403, 404, 400, 400, 400]);
    expect(badId.body).toMatchObject({ errors: [{ path: 'installationId' }] });
  });
});

describe('GET /repositories/:id', () => {
  it('returns one repository, 403 when foreign and 404 when unknown', async () => {
    const own = await get(`/repositories/${seeded.repositoryId}`);
    const foreign = await get(`/repositories/${seeded.foreignRepositoryId}`);
    const missing = await get(`/repositories/${'0'.repeat(24)}`);

    expect(own.body).toMatchObject({ fullName: `${LOGIN}/payments`, openPullRequests: 1 });
    expect([foreign.status, missing.status]).toEqual([403, 404]);
  });
});

describe('pull requests', () => {
  it('lists open PRs by default and all PRs on request, each with its latest run', async () => {
    const open = PullRequestPageSchema.parse(
      (await get(`/repositories/${seeded.repositoryId}/pulls`)).body,
    );
    const all = PullRequestPageSchema.parse(
      (await get(`/repositories/${seeded.repositoryId}/pulls?state=all`)).body,
    );

    expect(open.data.map((pr) => pr.number)).toEqual([2]);
    expect(open.data[0]?.latestRun).toMatchObject({ id: seeded.runId, attempt: 1 });
    expect(all.data.map((pr) => pr.number).sort()).toEqual([1, 2]);
  });

  it('shows one PR with its run timeline, and 404 for an unknown number', async () => {
    const detail = await get(`/repositories/${seeded.repositoryId}/pulls/2`);
    const missing = await get(`/repositories/${seeded.repositoryId}/pulls/99`);

    expect(PullRequestDetailSchema.parse(detail.body)).toMatchObject({
      number: 2,
      htmlUrl: `https://github.com/${LOGIN}/payments/pull/2`,
      runs: [{ id: seeded.runId }],
    });
    expect(missing.status).toBe(404);
  });

  it('answers 403 for a repository in a foreign installation', async () => {
    expect((await get(`/repositories/${seeded.foreignRepositoryId}/pulls`)).status).toBe(403);
  });
});

describe('GET /runs/:id', () => {
  it('lists findings without the filtered ones and links inline ones to their thread', async () => {
    const response = await get(`/runs/${seeded.runId}`);

    const run = RunDetailSchema.parse(response.body);
    expect(run.findings).toHaveLength(1);
    expect(run.filteredCount).toBe(1);
    expect(run.canRerun).toBe(true);
    expect(run.findings[0]?.githubUrl).toBe(
      `https://github.com/${LOGIN}/payments/pull/2#discussion_r77`,
    );
  });

  it('answers 404 for an unknown run', async () => {
    expect((await get(`/runs/${'0'.repeat(24)}`)).status).toBe(404);
  });
});

describe('GitHub-backed reads', () => {
  it('returns the policy file from the default branch with its validation errors', async () => {
    fakeGithub.fileContents.set(
      `${LOGIN}/payments@main:.mergemind.yml`,
      'version: 1\ngate:\n  failOn: sometimes\n',
    );

    const policy = PolicyResponseSchema.parse(
      (await get(`/repositories/${seeded.repositoryId}/policy`)).body,
    );

    expect(policy).toMatchObject({
      ref: 'main',
      source: 'default',
      policy: { gate: { failOn: 'critical' } },
    });
    expect(policy.errors.join(' ')).toContain('failOn');
  });

  it('returns the flagged lines with context at the run head', async () => {
    const file = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');
    fakeGithub.fileContents.set(`${LOGIN}/payments@${HEAD}:src/pay.ts`, file);

    const snippet = SnippetResponseSchema.parse(
      (await get(`/findings/${seeded.findingId}/snippet`)).body,
    );

    expect(snippet.highlight).toEqual({ start: 3, end: 3 });
    expect(snippet.lines.map((line) => line.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('answers 404 when the file is gone and 503 without the GitHub App', async () => {
    const gone = await get(`/findings/${seeded.findingId}/snippet`);
    const noGithubApp = buildApiApp({ redis, github: null, now: () => NOW });
    const unavailable = await request(noGithubApp)
      .get(`/api/v1/repositories/${seeded.repositoryId}/policy`)
      .set('authorization', `Bearer ${token}`);

    expect(gone.status).toBe(404);
    expect(unavailable.status).toBe(503);
  });
});

describe('GET /installations/:id/usage', () => {
  it('sums this month by kind against the budget', async () => {
    const response = await get(`/installations/${seeded.installationId}/usage`);

    expect(UsageResponseSchema.parse(response.body)).toEqual({
      period: '2026-10',
      usedTokens: 1550,
      monthlyTokenBudget: 2_000_000,
      state: 'ok',
      byKind: { review: 1200, embed: 0, ci_summary: 350 },
    });
  });
});
