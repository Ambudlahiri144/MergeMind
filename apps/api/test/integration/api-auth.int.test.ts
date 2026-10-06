import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createInstallationsRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import { createFakeGithub } from '@mergemind/github/testing';
import { MeResponseSchema } from '@mergemind/shared';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from 'vitest';

import type { ApiRouterDeps } from '../../src/routes/api.routes.js';
import { buildApiApp, createTestGithub, failOnExternalRequests } from '../support/api-app.js';
import { signTestToken } from '../support/api-token.js';

const fakeGithub = createFakeGithub();
const server = setupServer(...fakeGithub.handlers);
const installations = createInstallationsRepository();
const github = createTestGithub();

let redis: Redis;
let now = new Date('2026-10-06T12:00:00Z');

function buildApp(overrides: Partial<ApiRouterDeps> = {}) {
  return buildApiApp({ redis, github, now: () => now, overrides });
}

let nextId = 720_000;
async function createInstallation(
  accountType: 'User' | 'Organization',
  accountLogin: string,
  status: 'active' | 'suspended' = 'active',
) {
  nextId += 1;
  const id = await installations.upsertFromGithub({
    githubInstallationId: nextId,
    accountLogin,
    accountType,
    status,
  });
  return { id, githubInstallationId: nextId };
}

beforeAll(async () => {
  server.listen(failOnExternalRequests);
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
  redis = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
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

describe('authentication (ADR-029)', () => {
  it('keeps health public but refuses /me without a bearer token', async () => {
    const app = buildApp();

    const health = await request(app).get('/api/v1/health');
    const me = await request(app).get('/api/v1/me');

    expect(health.status).toBe(200);
    expect(me.status).toBe(401);
    expect(me.headers['content-type']).toContain('application/problem+json');
    expect(me.body).toMatchObject({ type: 'https://mergemind.dev/errors/unauthorized' });
  });

  it('refuses a token signed with another secret', async () => {
    const token = await signTestToken(
      { githubUserId: 1, login: 'x' },
      { secret: 'some-other-secret-that-is-also-long-enough' },
    );

    const response = await request(buildApp())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('answers 503 for every authenticated route when API_JWT_SECRET is unset', async () => {
    const response = await request(buildApp({ jwtSecret: null })).get('/api/v1/me');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ type: 'https://mergemind.dev/errors/unavailable' });
  });
});

describe('GET /me (ADR-030)', () => {
  it('lists the user installation they own and the org installations they belong to', async () => {
    const suffix = randomUUID().slice(0, 6);
    const login = `ananya-${suffix}`;
    const own = await createInstallation('User', login);
    const org = await createInstallation('Organization', `org-member-${suffix}`);
    const foreign = await createInstallation('Organization', `org-foreign-${suffix}`);
    const suspended = await createInstallation('User', login, 'suspended');
    fakeGithub.orgMemberships.set(`org-member-${suffix}:${login}`, {
      role: 'member',
      state: 'active',
    });
    const token = await signTestToken({ githubUserId: 3001, login });

    const response = await request(buildApp())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = MeResponseSchema.parse(response.body);
    const roles = Object.fromEntries(body.installations.map((entry) => [entry.id, entry.role]));
    expect(roles[own.id]).toBe('owner');
    expect(roles[org.id]).toBe('member');
    expect(roles[foreign.id]).toBeUndefined();
    expect(roles[suspended.id]).toBeUndefined();
  });

  it('reuses the cached access for ten minutes, then asks GitHub again', async () => {
    const login = `rohan-${randomUUID().slice(0, 6)}`;
    const org = await createInstallation('Organization', `org-cache-${randomUUID().slice(0, 6)}`);
    const installation = await installations.findById(org.id);
    fakeGithub.orgMemberships.set(`${installation?.accountLogin ?? ''}:${login}`, {
      role: 'admin',
      state: 'active',
    });
    const token = await signTestToken({ githubUserId: 3002, login });
    const app = buildApp();
    const membershipCalls = () =>
      fakeGithub.requests.filter((call) => call.path.includes('/memberships/')).length;

    await request(app).get('/api/v1/me').set('authorization', `Bearer ${token}`);
    const afterFirst = membershipCalls();
    await request(app).get('/api/v1/me').set('authorization', `Bearer ${token}`);
    const afterCached = membershipCalls();
    now = new Date(now.getTime() + 11 * 60 * 1000);
    await request(app).get('/api/v1/me').set('authorization', `Bearer ${token}`);

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterCached).toBe(afterFirst);
    expect(membershipCalls()).toBeGreaterThan(afterCached);
  });
});

describe('rate limit', () => {
  it('answers 429 with Retry-After once a user exceeds the limit', async () => {
    const app = buildApp({ rateLimit: { limit: 2, redis, prefix: `rl-${randomUUID()}:` } });
    const token = await signTestToken({ githubUserId: 3003, login: 'kavya-rao' });

    const statuses = [];
    let last;
    for (let index = 0; index < 3; index += 1) {
      last = await request(app).get('/api/v1/me').set('authorization', `Bearer ${token}`);
      statuses.push(last.status);
    }

    expect(statuses).toEqual([200, 200, 429]);
    expect(last?.headers['retry-after']).toBe('60');
    expect(last?.body).toMatchObject({ type: 'https://mergemind.dev/errors/rate-limited' });
  });
});
