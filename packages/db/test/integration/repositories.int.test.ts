import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { connectMongo, disconnectMongo } from '../../src/connection.js';
import { ensureDbIndexes } from '../../src/indexes.js';
import { createInstallationsRepository } from '../../src/repositories/installations.repository.js';
import { createPullRequestsRepository } from '../../src/repositories/pull-requests.repository.js';
import { createRepositoriesRepository } from '../../src/repositories/repositories.repository.js';
import {
  STALE_CLAIM_MS,
  createWebhookDeliveriesRepository,
} from '../../src/repositories/webhook-deliveries.repository.js';

const installations = createInstallationsRepository();
const repositories = createRepositoriesRepository();
const pullRequests = createPullRequestsRepository();
const deliveries = createWebhookDeliveriesRepository();

beforeAll(async () => {
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

async function indexKeys(collection: string): Promise<string[]> {
  const indexes = await mongoose.connection.collection(collection).indexes();
  return indexes.map((index) => `${JSON.stringify(index.key)}${index.unique ? ' unique' : ''}`);
}

describe('declared indexes', () => {
  it('creates the unique keys that back idempotency', async () => {
    expect(await indexKeys('webhookDeliveries')).toContain('{"deliveryId":1} unique');
    expect(await indexKeys('installations')).toContain('{"githubInstallationId":1} unique');
    expect(await indexKeys('repositories')).toContain('{"githubRepoId":1} unique');
    expect(await indexKeys('pullRequests')).toContain('{"repositoryId":1,"number":1} unique');
  });

  it('expires webhook deliveries after 7 days', async () => {
    const indexes = await mongoose.connection.collection('webhookDeliveries').indexes();

    const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);

    expect(ttl).toMatchObject({ key: { createdAt: 1 }, expireAfterSeconds: 604_800 });
  });
});

describe('webhookDeliveries.claim', () => {
  it('claims a new delivery once and reports duplicates', async () => {
    const input = { deliveryId: randomUUID(), event: 'pull_request', action: 'opened' };

    const first = await deliveries.claim(input);
    const second = await deliveries.claim(input);

    expect(first).toEqual({ isClaimed: true, attempt: 1 });
    expect(second).toEqual({ isClaimed: false, status: 'received' });
  });

  it('does not reclaim a delivery that finished', async () => {
    const input = { deliveryId: randomUUID(), event: 'pull_request' };
    await deliveries.claim(input);
    await deliveries.markStatus(input.deliveryId, 'enqueued', { reason: 'job_enqueued' });

    expect(await deliveries.claim(input)).toEqual({ isClaimed: false, status: 'enqueued' });
  });

  it('reclaims a failed delivery and clears its error', async () => {
    const input = { deliveryId: randomUUID(), event: 'pull_request' };
    await deliveries.claim(input);
    await deliveries.markStatus(input.deliveryId, 'failed', { error: 'boom' });

    const claim = await deliveries.claim(input);

    expect(claim).toEqual({ isClaimed: true, attempt: 2 });
    expect(await deliveries.findByDeliveryId(input.deliveryId)).toMatchObject({
      status: 'received',
      attempts: 2,
    });
    expect(await deliveries.findByDeliveryId(input.deliveryId)).not.toHaveProperty('error');
  });

  it('reclaims a delivery stuck in received after a crash', async () => {
    const input = { deliveryId: randomUUID(), event: 'pull_request' };
    await deliveries.claim(input);
    const later = new Date(Date.now() + STALE_CLAIM_MS + 1_000);

    expect(await deliveries.claim(input, later)).toEqual({ isClaimed: true, attempt: 2 });
  });
});

describe('installations and repositories', () => {
  it('upserts an installation idempotently with default budget and allowlist', async () => {
    const input = {
      githubInstallationId: 1001,
      accountLogin: 'octo-demo',
      accountType: 'Organization' as const,
      status: 'active' as const,
    };

    const firstId = await installations.upsertFromGithub(input);
    const secondId = await installations.upsertFromGithub({ ...input, status: 'suspended' });

    expect(secondId).toBe(firstId);
    expect(await installations.findByGithubId(1001)).toMatchObject({
      status: 'suspended',
      monthlyTokenBudget: 2_000_000,
      allowedProviders: ['groq', 'ollama'],
    });
  });

  it('bulk upserts repos, uninstalls them, and reinstalls without touching isEnabled', async () => {
    const installationId = await installations.upsertFromGithub({
      githubInstallationId: 1002,
      accountLogin: 'acme',
      accountType: 'User',
      status: 'active',
    });
    const repos = [
      { githubRepoId: 5001, fullName: 'acme/a', isPrivate: true },
      { githubRepoId: 5002, fullName: 'acme/b', isPrivate: false },
    ];

    expect(await repositories.upsertManyForInstallation(installationId, repos)).toBe(2);
    expect(await repositories.upsertManyForInstallation(installationId, repos)).toBe(2);
    expect(await repositories.markAllUninstalledForInstallation(installationId)).toBe(2);
    await repositories.upsertManyForInstallation(installationId, repos);

    expect(await repositories.findByGithubRepoId(5001)).toMatchObject({
      installationId,
      fullName: 'acme/a',
      isPrivate: true,
      isInstalled: true,
      isEnabled: true,
    });
  });

  it('marks only the listed repos uninstalled', async () => {
    const installationId = await installations.upsertFromGithub({
      githubInstallationId: 1003,
      accountLogin: 'beta',
      accountType: 'Organization',
      status: 'active',
    });
    await repositories.upsertManyForInstallation(installationId, [
      { githubRepoId: 6001, fullName: 'beta/x', isPrivate: false },
      { githubRepoId: 6002, fullName: 'beta/y', isPrivate: false },
    ]);

    await repositories.markUninstalled([6002]);

    expect((await repositories.findByGithubRepoId(6001))?.isInstalled).toBe(true);
    expect((await repositories.findByGithubRepoId(6002))?.isInstalled).toBe(false);
  });

  it('updates name and visibility from GitHub without reinstalling or creating repos', async () => {
    const installationId = await installations.upsertFromGithub({
      githubInstallationId: 1004,
      accountLogin: 'gamma',
      accountType: 'User',
      status: 'active',
    });
    await repositories.upsertManyForInstallation(installationId, [
      { githubRepoId: 7001, fullName: 'gamma/old', isPrivate: true },
    ]);
    await repositories.markUninstalled([7001]);

    const isTracked = await repositories.updateFromGithub(7001, {
      fullName: 'gamma/new',
      isPrivate: false,
    });
    const isUnknownTracked = await repositories.updateFromGithub(7999, { isPrivate: false });

    expect(isTracked).toBe(true);
    expect(isUnknownTracked).toBe(false);
    expect(await repositories.findByGithubRepoId(7001)).toMatchObject({
      fullName: 'gamma/new',
      isPrivate: false,
      isInstalled: false,
    });
    expect(await repositories.findByGithubRepoId(7999)).toBeNull();
  });
});

describe('pullRequests.upsertIfNewer', () => {
  const baseInput = {
    repositoryId: new mongoose.Types.ObjectId().toString(),
    number: 42,
    title: 'Add refunds',
    authorLogin: 'dev-alice',
    baseRef: 'main',
    headRef: 'feat/refunds',
    state: 'open' as const,
    isDraft: false,
  };

  it('applies a newer snapshot and ignores an older one delivered late', async () => {
    const newer = {
      ...baseInput,
      headSha: 'b'.repeat(40),
      githubUpdatedAt: new Date('2026-10-05T11:00:00Z'),
    };
    const older = {
      ...baseInput,
      headSha: 'a'.repeat(40),
      githubUpdatedAt: new Date('2026-10-05T10:00:00Z'),
    };

    expect(await pullRequests.upsertIfNewer(newer)).toEqual({ isApplied: true });
    expect(await pullRequests.upsertIfNewer(older)).toEqual({ isApplied: false });

    expect(await pullRequests.findByNumber(baseInput.repositoryId, 42)).toMatchObject({
      headSha: 'b'.repeat(40),
    });
  });

  it('applies a snapshot with the same timestamp (idempotent replay)', async () => {
    const input = {
      ...baseInput,
      number: 43,
      headSha: 'c'.repeat(40),
      githubUpdatedAt: new Date('2026-10-05T12:00:00Z'),
    };
    await pullRequests.upsertIfNewer(input);

    expect(await pullRequests.upsertIfNewer({ ...input, state: 'merged' })).toEqual({
      isApplied: true,
    });
    expect((await pullRequests.findByNumber(baseInput.repositoryId, 43))?.state).toBe('merged');
  });
});
