import { createLogger } from '@mergemind/shared/logger';
import {
  TEST_WEBHOOK_SECRET,
  buildSignedWebhook,
  signWebhookBody,
} from '@mergemind/shared/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { IncomingWebhook, WebhookOutcome } from '../services/webhook.service.js';

function buildApp() {
  const received: IncomingWebhook[] = [];
  const app = createApp({
    logger: createLogger({ name: 'test', level: 'silent' }),
    readinessChecks: [],
    webhook: {
      secret: TEST_WEBHOOK_SECRET,
      service: {
        process: (webhook): Promise<WebhookOutcome> => {
          received.push(webhook);
          return Promise.resolve({
            deliveryId: webhook.deliveryId,
            status: 'enqueued',
            reason: 'review_enqueued',
            jobId: 'job-1',
          });
        },
      },
    },
  });
  return { app, received };
}

const signed = buildSignedWebhook({
  event: 'pull_request',
  payload: { action: 'opened', number: 1 },
  secret: TEST_WEBHOOK_SECRET,
  deliveryId: 'delivery-1',
});

describe('POST /webhooks/github', () => {
  it('returns 202 with the service outcome and passes the parsed payload through', async () => {
    const { app, received } = buildApp();

    const response = await request(app)
      .post('/webhooks/github')
      .set(signed.headers)
      .send(signed.body);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      deliveryId: 'delivery-1',
      status: 'enqueued',
      reason: 'review_enqueued',
      jobId: 'job-1',
    });
    expect(received).toEqual([
      { event: 'pull_request', deliveryId: 'delivery-1', payload: { action: 'opened', number: 1 } },
    ]);
  });

  it('returns 401 and never calls the service for a bad signature', async () => {
    const { app, received } = buildApp();

    const response = await request(app)
      .post('/webhooks/github')
      .set({
        ...signed.headers,
        'x-hub-signature-256': signWebhookBody(signed.body, 'wrong-secret'),
      })
      .send(signed.body);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ type: 'https://mergemind.dev/errors/unauthorized' });
    expect(received).toHaveLength(0);
  });

  it('returns 401 for a body changed after signing', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post('/webhooks/github')
      .set(signed.headers)
      .send(signed.body.replace('opened', 'closed'));

    expect(response.status).toBe(401);
  });

  it('returns 400 naming the missing GitHub headers', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .post('/webhooks/github')
      .set({ 'content-type': 'application/json' })
      .send(signed.body);

    expect(response.status).toBe(400);
    expect((response.body as { errors: unknown }).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'x-github-event' }),
        expect.objectContaining({ path: 'x-github-delivery' }),
      ]),
    );
  });

  it('returns 400 for a correctly signed body that is not JSON', async () => {
    const { app } = buildApp();
    const body = 'payload=not-json';

    const response = await request(app)
      .post('/webhooks/github')
      .set({
        ...signed.headers,
        'content-type': 'application/x-www-form-urlencoded',
        'x-hub-signature-256': signWebhookBody(body, TEST_WEBHOOK_SECRET),
      })
      .send(body);

    expect(response.status).toBe(400);
    expect((response.body as { detail: unknown }).detail).toBe('Webhook body is not valid JSON');
  });
});
