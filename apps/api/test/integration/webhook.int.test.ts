import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createWebhookDeliveriesRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import {
  QUEUE_NAMES,
  buildIndexJobId,
  buildReviewJobId,
  type IndexRepoJobData,
} from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import {
  TEST_WEBHOOK_SECRET,
  buildSignedWebhook,
  loadGithubFixture,
} from '@mergemind/shared/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { createApp } from '../../src/app.js';
import { createIndexProducer, type IndexProducer } from '../../src/queues/index.producer.js';
import { createReviewProducer, type ReviewProducer } from '../../src/queues/review.producer.js';
import { createWebhookService } from '../../src/services/webhook.service.js';

const ACK_P95_TARGET_MS = 300;
const LATENCY_SAMPLES = 20;
const OPENED_HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SYNCED_HEAD_SHA = 'b2c3d4e5f60718293a4b5c6d7e8f901234567890';

const deliveries = createWebhookDeliveriesRepository();
const installations = createInstallationsRepository();
const repositories = createRepositoriesRepository();
const pullRequests = createPullRequestsRepository();

let redis: Redis;
let reviewProducer: ReviewProducer;
let indexProducer: IndexProducer;
let queue: Queue;
let indexQueue: Queue<IndexRepoJobData>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
  redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
  const prefix = `test-${randomUUID()}`;
  reviewProducer = createReviewProducer({ connection: redis, prefix });
  queue = new Queue(QUEUE_NAMES.review, { connection: redis, prefix });
  indexProducer = createIndexProducer({ connection: redis, prefix });
  indexQueue = new Queue(QUEUE_NAMES.index, { connection: redis, prefix });

  app = createApp({
    logger: createLogger({ name: 'test', level: 'silent' }),
    readinessChecks: [],
    webhook: {
      secret: TEST_WEBHOOK_SECRET,
      service: createWebhookService({
        deliveries,
        installations,
        repositories,
        pullRequests,
        reviewProducer,
        indexProducer,
      }),
    },
  });
});

afterAll(async () => {
  await queue.close();
  await indexQueue.close();
  await reviewProducer.close();
  await indexProducer.close();
  await redis.quit();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

type Mutate = (payload: Record<string, unknown>) => void;

/** Gives a test its own GitHub repo id so its job ids never collide with another test's. */
function withRepoId(githubRepoId: number): Mutate {
  return (payload) => {
    (payload.repository as { id: number }).id = githubRepoId;
  };
}

async function sendFixture(
  name: string,
  options: { deliveryId?: string; mutate?: Mutate; secret?: string } = {},
) {
  const { event, payload } = await loadGithubFixture(name);
  options.mutate?.(payload);
  const signed = buildSignedWebhook({
    event,
    payload,
    secret: options.secret ?? TEST_WEBHOOK_SECRET,
    ...(options.deliveryId === undefined ? {} : { deliveryId: options.deliveryId }),
  });
  const response = await request(app)
    .post('/webhooks/github')
    .set(signed.headers)
    .send(signed.body);
  return { response, deliveryId: signed.deliveryId };
}

async function waitingJobIdsForRepo(githubRepoId: number): Promise<string[]> {
  const jobs = await queue.getWaiting();
  return jobs.map((job) => job.id ?? '').filter((id) => id.startsWith(`${githubRepoId}#`));
}

describe('pull_request review events', () => {
  it('returns 202 and enqueues one job with the deterministic id', async () => {
    const { response, deliveryId } = await sendFixture('pull_request.opened', {
      mutate: withRepoId(910001),
    });

    const jobId = buildReviewJobId({
      githubRepoId: 910001,
      prNumber: 42,
      headSha: OPENED_HEAD_SHA,
    });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      deliveryId,
      status: 'enqueued',
      reason: 'review_enqueued',
      jobId,
    });
    const job = await queue.getJob(jobId);
    expect(job?.name).toBe('review.pr');
    expect(job?.data).toMatchObject({ githubRepoId: 910001, prNumber: 42, trigger: 'opened' });
    expect(await deliveries.findByDeliveryId(deliveryId)).toMatchObject({ status: 'enqueued' });
  });

  it('records one delivery and one job when the same delivery arrives 3 times', async () => {
    const deliveryId = randomUUID();
    const send = () =>
      sendFixture('pull_request.opened', { deliveryId, mutate: withRepoId(910002) });

    const responses = [await send(), await send(), await send()].map(({ response }) => response);

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    expect(responses.map((response) => (response.body as { status: string }).status)).toEqual([
      'enqueued',
      'duplicate',
      'duplicate',
    ]);
    expect(
      await mongoose.connection.collection('webhookDeliveries').countDocuments({ deliveryId }),
    ).toBe(1);
    expect(await waitingJobIdsForRepo(910002)).toHaveLength(1);
  });

  it('creates one job for two different deliveries of the same head SHA', async () => {
    await Promise.all([
      sendFixture('pull_request.opened', { mutate: withRepoId(910003) }),
      sendFixture('pull_request.opened', { mutate: withRepoId(910003) }),
    ]);

    expect(await waitingJobIdsForRepo(910003)).toEqual([
      buildReviewJobId({ githubRepoId: 910003, prNumber: 42, headSha: OPENED_HEAD_SHA }),
    ]);
  });

  it('gives ready_for_review its own job so a skipped draft review cannot swallow it', async () => {
    await sendFixture('pull_request.opened', { mutate: withRepoId(910007) });
    await sendFixture('pull_request.ready_for_review', { mutate: withRepoId(910007) });

    expect((await waitingJobIdsForRepo(910007)).toSorted()).toEqual([
      buildReviewJobId({ githubRepoId: 910007, prNumber: 42, headSha: OPENED_HEAD_SHA }),
      buildReviewJobId({
        githubRepoId: 910007,
        prNumber: 42,
        headSha: OPENED_HEAD_SHA,
        trigger: 'ready_for_review',
      }),
    ]);
  });

  it('reprocesses a failed delivery when GitHub redelivers it', async () => {
    const deliveryId = randomUUID();
    const breakSha: Mutate = (payload) => {
      withRepoId(910004)(payload);
      (payload.pull_request as { head: { sha: string } }).head.sha = 'not-a-sha';
    };

    const first = await sendFixture('pull_request.opened', { deliveryId, mutate: breakSha });
    const failed = await deliveries.findByDeliveryId(deliveryId);
    const second = await sendFixture('pull_request.opened', {
      deliveryId,
      mutate: withRepoId(910004),
    });

    expect(first.response.status).toBe(400);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(second.response.status).toBe(202);
    expect(await deliveries.findByDeliveryId(deliveryId)).toMatchObject({
      status: 'enqueued',
      attempts: 2,
    });
    expect(await waitingJobIdsForRepo(910004)).toHaveLength(1);
  });

  it('writes nothing for an invalid signature', async () => {
    const { response, deliveryId } = await sendFixture('pull_request.opened', {
      secret: 'not-the-real-secret',
      mutate: withRepoId(910005),
    });

    expect(response.status).toBe(401);
    expect(await deliveries.findByDeliveryId(deliveryId)).toBeNull();
    expect(await waitingJobIdsForRepo(910005)).toHaveLength(0);
  });

  it(`acknowledges with p95 under ${ACK_P95_TARGET_MS} ms`, async () => {
    const durations: number[] = [];
    for (let sample = 0; sample < LATENCY_SAMPLES; sample += 1) {
      const startedAt = performance.now();
      const { response } = await sendFixture('pull_request.synchronize', {
        mutate: withRepoId(910006),
      });
      durations.push(performance.now() - startedAt);
      expect(response.status).toBe(202);
    }

    const sorted = durations.toSorted((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(ACK_P95_TARGET_MS);
  });
});

describe('installation events (PRD F1)', () => {
  it('creates the installation and its repositories', async () => {
    const { response } = await sendFixture('installation.created');

    expect(response.body).toMatchObject({ status: 'handled', reason: 'installation_created' });
    expect(await installations.findByGithubId(55500001)).toMatchObject({
      accountLogin: 'octo-demo',
      accountType: 'Organization',
      status: 'active',
    });
    expect(await repositories.findByGithubRepoId(77700001)).toMatchObject({
      fullName: 'octo-demo/payments-api',
      isPrivate: true,
      isInstalled: true,
    });
    expect(await repositories.findByGithubRepoId(77700002)).toMatchObject({ isInstalled: true });
  });

  it('adds and removes repositories from the installation', async () => {
    await sendFixture('installation.created');

    await sendFixture('installation_repositories.added');
    await sendFixture('installation_repositories.removed');

    expect((await repositories.findByGithubRepoId(77700003))?.isInstalled).toBe(true);
    expect((await repositories.findByGithubRepoId(77700002))?.isInstalled).toBe(false);
  });

  it('suspends, then uninstalls every repository on delete', async () => {
    await sendFixture('installation.created');

    await sendFixture('installation.suspend');
    const suspended = await installations.findByGithubId(55500001);
    await sendFixture('installation.deleted');

    expect(suspended?.status).toBe('suspended');
    expect((await installations.findByGithubId(55500001))?.status).toBe('deleted');
    expect((await repositories.findByGithubRepoId(77700001))?.isInstalled).toBe(false);
  });
});

describe('pull_request.closed', () => {
  it('records the merge and cancels the queued review for the head SHA', async () => {
    await sendFixture('installation.created');
    await sendFixture('pull_request.synchronize');
    const jobId = buildReviewJobId({
      githubRepoId: 77700001,
      prNumber: 42,
      headSha: SYNCED_HEAD_SHA,
    });
    const queuedBeforeClose = await queue.getJob(jobId);

    const { response } = await sendFixture('pull_request.closed');

    expect(queuedBeforeClose).toBeDefined();
    expect(response.body).toMatchObject({
      status: 'handled',
      reason: 'pr_closed_review_cancelled',
    });
    expect(await queue.getJob(jobId)).toBeUndefined();
    const repositoryId = await repositories.findIdByGithubRepoId(77700001);
    expect(await pullRequests.findByNumber(repositoryId ?? '', 42)).toMatchObject({
      state: 'merged',
      headSha: SYNCED_HEAD_SHA,
    });
  });
});

describe('code index triggers (PRD F6)', () => {
  it('enqueues index.repo for a push to the default branch', async () => {
    const { response, deliveryId } = await sendFixture('push.default-branch', {
      mutate: withRepoId(920001),
    });

    expect(response.status).toBe(202);
    expect(await deliveries.findByDeliveryId(deliveryId)).toMatchObject({
      status: 'enqueued',
      reason: 'index_enqueued',
    });
    const after = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';
    const job = await indexQueue.getJob(
      buildIndexJobId({ githubRepoId: 920001, commitSha: after }),
    );
    expect(job?.data).toMatchObject({ trigger: 'push', defaultBranch: 'main', commitSha: after });
  });

  it('ignores pushes to other branches', async () => {
    const { deliveryId } = await sendFixture('push.default-branch', {
      mutate: (payload) => {
        payload.ref = 'refs/heads/feature';
      },
    });

    expect(await deliveries.findByDeliveryId(deliveryId)).toMatchObject({
      status: 'ignored',
      reason: 'not_default_branch',
    });
  });

  it('enqueues a first index for every repo of a new installation', async () => {
    await sendFixture('installation.created');

    const jobs = await Promise.all(
      [77700001, 77700002].map((githubRepoId) =>
        indexQueue.getJob(buildIndexJobId({ githubRepoId, commitSha: null })),
      ),
    );
    expect(jobs.map((job) => job?.data.trigger)).toEqual(['installation', 'installation']);
  });
});
