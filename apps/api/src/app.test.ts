import { createLogger } from '@mergemind/shared/logger';
import { TEST_WEBHOOK_SECRET } from '@mergemind/shared/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { ReadinessCheck } from './services/readiness.service.js';

const silentLogger = createLogger({ name: 'test', level: 'silent' });

const healthyCheck = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
const failingCheck = (name: string): ReadinessCheck => ({
  name,
  check: () => Promise.reject(new Error('connection refused')),
});

function buildApp(readinessChecks: readonly ReadinessCheck[] = []) {
  return createApp({
    logger: silentLogger,
    readinessChecks,
    webhook: {
      secret: TEST_WEBHOOK_SECRET,
      service: { process: () => Promise.reject(new Error('not used in these tests')) },
    },
  });
}

describe('GET /api/v1/health', () => {
  it('returns 200 without touching dependencies', async () => {
    const response = await request(buildApp([failingCheck('mongo')])).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/v1/ready', () => {
  it('returns 200 when every dependency is up', async () => {
    const app = buildApp([healthyCheck('mongo'), healthyCheck('redis')]);

    const response = await request(app).get('/api/v1/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', checks: { mongo: 'up', redis: 'up' } });
  });

  it('returns 503 and names the dependency that is down', async () => {
    const app = buildApp([healthyCheck('mongo'), failingCheck('redis')]);

    const response = await request(app).get('/api/v1/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'not_ready', checks: { mongo: 'up', redis: 'down' } });
  });
});

describe('request ids', () => {
  it('echoes a safe incoming x-request-id', async () => {
    const response = await request(buildApp())
      .get('/api/v1/health')
      .set('x-request-id', 'req_abc-123');

    expect(response.headers['x-request-id']).toBe('req_abc-123');
  });

  it.each(['bad id; drop table', 'x'.repeat(129)])(
    'replaces an unsafe incoming x-request-id (%s) with a generated one',
    async (unsafeId) => {
      const response = await request(buildApp())
        .get('/api/v1/health')
        .set('x-request-id', unsafeId);

      expect(response.headers['x-request-id']).toMatch(/^req_[0-9a-f-]{36}$/);
    },
  );
});

describe('errors', () => {
  it('returns problem+json 404 for unknown routes', async () => {
    const response = await request(buildApp()).get('/api/v1/nope').set('x-request-id', 'req_1');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(response.body).toEqual({
      type: 'https://mergemind.dev/errors/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Route GET /api/v1/nope not found',
      instance: '/api/v1/nope',
      requestId: 'req_1',
    });
  });

  it('returns problem+json 400 for a malformed JSON body', async () => {
    const response = await request(buildApp())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      type: 'https://mergemind.dev/errors/validation',
      detail: 'Request body is not valid JSON',
    });
  });
});
