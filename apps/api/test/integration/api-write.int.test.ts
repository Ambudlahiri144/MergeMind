import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createFindingsRepository,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  createSuppressionsRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import { createFakeGithub } from '@mergemind/github/testing';
import { QUEUE_NAMES, type IndexRepoJobData, type ReviewPrJobData } from '@mergemind/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

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
const suppressions = createSuppressionsRepository();
const LOGIN = 'kavya-rao';
const HEAD = 'e'.repeat(40);
const queuePrefix = `test-${randomUUID()}`;

let redis: Redis;
let app: ReturnType<typeof buildApiApp>;
let token: string;
let reviewQueue: Queue<ReviewPrJobData>;
let indexQueue: Queue<IndexRepoJobData>;
let nextId = 830_000;

const auth = (call: request.Test) => call.set('authorization', `Bearer ${token}`);

async function createOwnedRepo(options: { isEnabled?: boolean } = {}) {
  nextId += 1;
  const installationId = await installations.upsertFromGithub({
    githubInstallationId: nextId,
    accountLogin: LOGIN,
    accountType: 'User',
    status: 'active',
  });
  const githubRepoId = nextId + 50_000;
  const repositoryId = await repositories.upsertForInstallation(installationId, {
    githubRepoId,
    fullName: `${LOGIN}/repo-${nextId}`,
    isPrivate: false,
    defaultBranch: 'main',
  });
  if (options.isEnabled === false) {
    await repositories.setEnabled(repositoryId, false);
  }
  return { installationId, repositoryId, githubRepoId };
}

/** An org installation where the test user is only a member. */
async function createMemberRepo() {
  nextId += 1;
  const org = `org-${nextId}`;
  const installationId = await installations.upsertFromGithub({
    githubInstallationId: nextId,
    accountLogin: org,
    accountType: 'Organization',
    status: 'active',
  });
  fakeGithub.orgMemberships.set(`${org}:${LOGIN}`, { role: 'member', state: 'active' });
  const repositoryId = await repositories.upsertForInstallation(installationId, {
    githubRepoId: nextId + 50_000,
    fullName: `${org}/service`,
    isPrivate: false,
    defaultBranch: 'main',
  });
  return { installationId, repositoryId };
}

async function createPrWithRun(
  repositoryId: string,
  options: { state?: 'open' | 'closed'; runHead?: string } = {},
) {
  await pullRequests.upsertIfNewer({
    repositoryId,
    number: 5,
    title: 'Rounding fix',
    authorLogin: 'rohan-mehta',
    baseRef: 'main',
    headRef: 'fix',
    headSha: HEAD,
    state: options.state ?? 'open',
    isDraft: false,
    githubUpdatedAt: new Date('2026-10-06T10:00:00Z'),
  });
  const pr = await pullRequests.findByNumber(repositoryId, 5);
  const { run } = await runs.startOrResume({
    repositoryId,
    pullRequestId: pr?.id ?? '',
    headSha: options.runHead ?? HEAD,
    baseSha: 'b'.repeat(40),
    trigger: 'opened',
    attempt: 1,
    promptVersion: 'security@2',
  });
  return { prId: pr?.id ?? '', runId: run.id };
}

beforeAll(async () => {
  server.listen(failOnExternalRequests);
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
  redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
  app = buildApiApp({ redis, github, queuePrefix });
  reviewQueue = new Queue(QUEUE_NAMES.review, { connection: redis, prefix: queuePrefix });
  indexQueue = new Queue(QUEUE_NAMES.index, { connection: redis, prefix: queuePrefix });
  token = await signTestToken({ githubUserId: 5001, login: LOGIN });
});

afterAll(async () => {
  server.close();
  await reviewQueue.close();
  await indexQueue.close();
  await redis.quit();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('PATCH /repositories/:id', () => {
  it('lets the owner disable a repository', async () => {
    const { repositoryId } = await createOwnedRepo();

    const response = await auth(
      request(app).patch(`/api/v1/repositories/${repositoryId}`).send({ isEnabled: false }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: repositoryId, isEnabled: false });
    expect((await repositories.findById(repositoryId))?.isEnabled).toBe(false);
  });

  it('refuses a plain org member (403) and unknown fields (400)', async () => {
    const { repositoryId } = await createMemberRepo();

    const member = await auth(
      request(app).patch(`/api/v1/repositories/${repositoryId}`).send({ isEnabled: false }),
    );
    const extra = await auth(
      request(app)
        .patch(`/api/v1/repositories/${repositoryId}`)
        .send({ isEnabled: true, isPrivate: false }),
    );

    expect(member.status).toBe(403);
    expect(extra.status).toBe(400);
  });
});

describe('POST /repositories/:id/reindex', () => {
  it('enqueues a manual full index, and refuses while one is running', async () => {
    const { repositoryId, githubRepoId } = await createOwnedRepo();

    const accepted = await auth(request(app).post(`/api/v1/repositories/${repositoryId}/reindex`));
    await repositories.setIndexStatus(repositoryId, 'indexing');
    const busy = await auth(request(app).post(`/api/v1/repositories/${repositoryId}/reindex`));

    expect(accepted.status).toBe(202);
    const jobId = (accepted.body as { jobId: string }).jobId;
    expect(jobId).toMatch(new RegExp(`^${String(githubRepoId)}@manual-\\d{12}$`));
    expect((await indexQueue.getJob(jobId))?.data).toMatchObject({
      trigger: 'manual',
      commitSha: null,
    });
    expect(busy.status).toBe(409);
  });

  it('refuses a disabled repository', async () => {
    const { repositoryId } = await createOwnedRepo({ isEnabled: false });

    const response = await auth(request(app).post(`/api/v1/repositories/${repositoryId}/reindex`));

    expect(response.status).toBe(409);
  });
});

describe('POST /runs/:id/rerun', () => {
  it('enqueues the next attempt at the current head each time', async () => {
    const { repositoryId, githubRepoId } = await createOwnedRepo();
    const { prId, runId } = await createPrWithRun(repositoryId);

    const first = await auth(request(app).post(`/api/v1/runs/${runId}/rerun`));
    await runs.startOrResume({
      repositoryId,
      pullRequestId: prId,
      headSha: HEAD,
      baseSha: 'b'.repeat(40),
      trigger: 'manual',
      attempt: 2,
      promptVersion: 'security@2',
    });
    const second = await auth(request(app).post(`/api/v1/runs/${runId}/rerun`));

    expect([first.status, second.status]).toEqual([202, 202]);
    expect((first.body as { jobId: string }).jobId).toBe(`${String(githubRepoId)}#5@${HEAD}-a2`);
    expect((second.body as { jobId: string }).jobId).toBe(`${String(githubRepoId)}#5@${HEAD}-a3`);
    const job = await reviewQueue.getJob(`${String(githubRepoId)}#5@${HEAD}-a2`);
    expect(job?.data).toMatchObject({ trigger: 'manual', attempt: 2, prNumber: 5 });
  });

  it('refuses a closed PR or a run of an older head (409)', async () => {
    const closed = await createOwnedRepo();
    const { runId: closedRun } = await createPrWithRun(closed.repositoryId, { state: 'closed' });
    const stale = await createOwnedRepo();
    const { runId: staleRun } = await createPrWithRun(stale.repositoryId, {
      runHead: 'f'.repeat(40),
    });

    const closedResponse = await auth(request(app).post(`/api/v1/runs/${closedRun}/rerun`));
    const staleResponse = await auth(request(app).post(`/api/v1/runs/${staleRun}/rerun`));

    expect([closedResponse.status, staleResponse.status]).toEqual([409, 409]);
  });
});

describe('PATCH /findings/:id (PRD F8)', () => {
  async function createFinding(state: 'open' | 'resolved' = 'open') {
    const { repositoryId } = await createOwnedRepo();
    const { prId, runId } = await createPrWithRun(repositoryId);
    const fingerprint = randomUUID().replace(/-/g, '').padEnd(64, '0');
    await findings.insertForRun({ reviewRunId: runId, pullRequestId: prId, repositoryId }, [
      {
        pass: 'maintainability',
        severity: 'minor',
        confidence: 0.8,
        category: 'other',
        path: 'src/a.ts',
        lineStart: 1,
        lineEnd: 1,
        title: 'Unclear name',
        body: 'b',
        suggestion: null,
        fingerprint,
        state,
        placement: 'summary',
      },
    ]);
    const [finding] = await findings.listForRun(runId);
    return { repositoryId, fingerprint, findingId: finding?.id ?? '' };
  }

  it('dismisses a finding and suppresses its fingerprint, idempotently', async () => {
    const { repositoryId, fingerprint, findingId } = await createFinding();
    const dismiss = () =>
      auth(
        request(app)
          .patch(`/api/v1/findings/${findingId}`)
          .send({ state: 'dismissed', reason: 'Intended naming' }),
      );

    const first = await dismiss();
    const second = await dismiss();

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual({ id: findingId, state: 'dismissed' });
    expect((await findings.findById(findingId))?.state).toBe('dismissed');
    expect(await suppressions.findSuppressed(repositoryId, [fingerprint])).toEqual(
      new Set([fingerprint]),
    );
  });

  it('refuses a resolved finding (409) and any other target state (400)', async () => {
    const { findingId } = await createFinding('resolved');

    const resolved = await auth(
      request(app).patch(`/api/v1/findings/${findingId}`).send({ state: 'dismissed' }),
    );
    const wrongState = await auth(
      request(app).patch(`/api/v1/findings/${findingId}`).send({ state: 'open' }),
    );

    expect([resolved.status, wrongState.status]).toEqual([409, 400]);
  });
});

describe('PUT /installations/:id/budget', () => {
  it('lets the owner set the budget, but not a member, and rejects negatives', async () => {
    const owned = await createOwnedRepo();
    const member = await createMemberRepo();
    const put = (installationId: string, monthlyTokenBudget: number) =>
      auth(
        request(app)
          .put(`/api/v1/installations/${installationId}/budget`)
          .send({ monthlyTokenBudget }),
      );

    const ok = await put(owned.installationId, 750_000);
    const forbidden = await put(member.installationId, 750_000);
    const invalid = await put(owned.installationId, -1);

    expect([ok.status, forbidden.status, invalid.status]).toEqual([200, 403, 400]);
    expect((await installations.findById(owned.installationId))?.monthlyTokenBudget).toBe(750_000);
  });
});
