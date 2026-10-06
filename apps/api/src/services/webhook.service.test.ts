import type {
  DeliveryClaim,
  InstallationsRepository,
  PullRequestsRepository,
  RepositoriesRepository,
  WebhookDeliveriesRepository,
} from '@mergemind/db';
import { loadGithubFixture } from '@mergemind/shared/testing';
import { describe, expect, it } from 'vitest';

import type { ReviewProducer } from '../queues/review.producer.js';
import { createWebhookService } from './webhook.service.js';

type StatusUpdate = { deliveryId: string; status: string; details: unknown };

function notUsed(): never {
  throw new Error('not used in this test');
}

/** In-memory fakes: the service is pure orchestration over injected deps (Testing.md §5). */
function buildService(options: { claim?: DeliveryClaim; enqueue?: ReviewProducer['enqueue'] }) {
  const statusUpdates: StatusUpdate[] = [];
  const deliveries: WebhookDeliveriesRepository = {
    claim: () => Promise.resolve(options.claim ?? { isClaimed: true, attempt: 1 }),
    markStatus: (deliveryId, status, details) => {
      statusUpdates.push({ deliveryId, status, details });
      return Promise.resolve();
    },
    findByDeliveryId: notUsed,
  };
  const reviewProducer: ReviewProducer = {
    enqueue: options.enqueue ?? (() => Promise.resolve('job-1')),
    cancel: () => Promise.resolve(false),
    close: () => Promise.resolve(),
  };
  const service = createWebhookService({
    deliveries,
    reviewProducer,
    indexProducer: { enqueue: () => Promise.resolve('index-job'), close: () => Promise.resolve() },
    ciSummaryProducer: { enqueue: () => Promise.resolve('ci-job'), close: () => Promise.resolve() },
    installations: {} as InstallationsRepository,
    repositories: {} as RepositoriesRepository,
    pullRequests: {} as PullRequestsRepository,
  });
  return { service, statusUpdates };
}

describe('webhook service', () => {
  it('enqueues a review for pull_request.opened and records enqueued', async () => {
    const { payload } = await loadGithubFixture('pull_request.opened');
    const { service, statusUpdates } = buildService({});

    const outcome = await service.process({ event: 'pull_request', deliveryId: 'd1', payload });

    expect(outcome).toEqual({
      deliveryId: 'd1',
      status: 'enqueued',
      reason: 'review_enqueued',
      jobId: 'job-1',
    });
    expect(statusUpdates).toEqual([
      { deliveryId: 'd1', status: 'enqueued', details: { reason: 'review_enqueued' } },
    ]);
  });

  it('short-circuits a duplicate delivery without dispatching', async () => {
    const { payload } = await loadGithubFixture('pull_request.opened');
    const { service, statusUpdates } = buildService({
      claim: { isClaimed: false, status: 'enqueued' },
      enqueue: notUsed,
    });

    const outcome = await service.process({ event: 'pull_request', deliveryId: 'd1', payload });

    expect(outcome).toEqual({ deliveryId: 'd1', status: 'duplicate', reason: 'enqueued' });
    expect(statusUpdates).toHaveLength(0);
  });

  it('marks the delivery failed and rethrows when enqueueing fails', async () => {
    const { payload } = await loadGithubFixture('pull_request.opened');
    const { service, statusUpdates } = buildService({
      enqueue: () => Promise.reject(new Error('redis down')),
    });

    await expect(
      service.process({ event: 'pull_request', deliveryId: 'd1', payload }),
    ).rejects.toThrow('redis down');
    expect(statusUpdates).toEqual([
      { deliveryId: 'd1', status: 'failed', details: { error: 'redis down' } },
    ]);
  });

  it('rejects an invalid payload as a ValidationError and records failed', async () => {
    const { service, statusUpdates } = buildService({});

    await expect(
      service.process({ event: 'pull_request', deliveryId: 'd1', payload: { action: 'opened' } }),
    ).rejects.toMatchObject({ status: 400, message: 'Invalid pull_request payload' });
    expect(statusUpdates[0]?.status).toBe('failed');
  });

  it('records an unsupported event as ignored', async () => {
    const { service } = buildService({});

    const outcome = await service.process({
      event: 'ping',
      deliveryId: 'd1',
      payload: { zen: 'Keep it logically awesome.' },
    });

    expect(outcome).toEqual({ deliveryId: 'd1', status: 'ignored', reason: 'unsupported_event' });
  });
});
