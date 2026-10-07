import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import { createGithubApp } from '@mergemind/github';
import { createFakeGithub, createTestPrivateKey } from '@mergemind/github/testing';
import type { ReviewPrJobInput } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest';

import { reconcileReviews } from '../../src/recovery/reconcile-reviews.js';

const fakeGithub = createFakeGithub();
const server = setupServer(...fakeGithub.handlers);
const logger = createLogger({ name: 'test', level: 'silent' });
const github = createGithubApp({
  appId: 4244,
  privateKey: createTestPrivateKey(),
  logger,
  retries: 0,
  isThrottled: false,
});
const installations = createInstallationsRepository();
const repositories = createRepositoriesRepository();
const pullRequests = createPullRequestsRepository();
const reviewRuns = createReviewRunsRepository();

const NOW = new Date('2026-10-08T12:00:00Z');
const HEAD = 'a'.repeat(40);
const NEWER_HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);

let nextId = 870_000;
let enqueued: ReviewPrJobInput[] = [];

async function createRepo(options: { isEnabled?: boolean } = {}) {
  nextId += 1;
  const githubInstallationId = nextId;
  const fullName = `ananya-iyer/reconcile-${String(nextId)}`;
  const installationId = await installations.upsertFromGithub({
    githubInstallationId,
    accountLogin: 'ananya-iyer',
    accountType: 'User',
    status: 'active',
  });
  const repositoryId = await repositories.upsertForInstallation(installationId, {
    githubRepoId: nextId + 100_000,
    fullName,
    isPrivate: false,
    defaultBranch: 'main',
  });
  if (options.isEnabled === false) {
    await repositories.setEnabled(repositoryId, false);
  }
  return { repositoryId, fullName, githubInstallationId };
}

async function openPull(
  repo: { repositoryId: string; fullName: string },
  options: {
    number?: number;
    isDraft?: boolean;
    live?: { state?: 'open' | 'closed'; headSha?: string };
  } = {},
) {
  const number = options.number ?? 1;
  await pullRequests.upsertIfNewer({
    repositoryId: repo.repositoryId,
    number,
    title: 'Fix refund rounding',
    authorLogin: 'rohan-mehta',
    baseRef: 'main',
    headRef: 'fix-refund-rounding',
    headSha: HEAD,
    state: 'open',
    isDraft: options.isDraft ?? false,
    githubUpdatedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
  });
  fakeGithub.pullStates.set(`${repo.fullName}#${String(number)}`, {
    state: options.live?.state ?? 'open',
    headSha: options.live?.headSha ?? HEAD,
    baseSha: BASE,
    isDraft: options.isDraft ?? false,
    title: 'Fix refund rounding',
    baseRef: 'main',
    headRef: 'fix-refund-rounding',
  });
  const pull = await pullRequests.findByNumber(repo.repositoryId, number);
  if (!pull) {
    throw new Error('seeded PR missing');
  }
  return pull;
}

async function startRun(repositoryId: string, pullRequestId: string, headSha: string) {
  const { run } = await reviewRuns.startOrResume({
    repositoryId,
    pullRequestId,
    headSha,
    baseSha: BASE,
    trigger: 'opened',
    attempt: 1,
    promptVersion: 'test@1',
  });
  return run;
}

function reconcile() {
  return reconcileReviews({
    pullRequests,
    reviewRuns,
    repositories,
    installations,
    github,
    enqueue: (data) => {
      enqueued.push(data);
      return Promise.resolve(`job-${String(enqueued.length)}`);
    },
    logger,
    now: () => NOW,
  });
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

beforeEach(async () => {
  enqueued = [];
  fakeGithub.reset();
  await mongoose.connection.db?.dropDatabase();
  await ensureDbIndexes();
});

afterAll(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('boot reconciliation (ADR-038)', () => {
  it('re-enqueues an open PR whose head was never reviewed (its job was lost with Redis)', async () => {
    const repo = await createRepo();
    await openPull(repo);

    await expect(reconcile()).resolves.toEqual({ checked: 1, enqueued: 1, failed: 0 });
    expect(enqueued[0]).toMatchObject({
      repoFullName: repo.fullName,
      prNumber: 1,
      headSha: HEAD,
      baseSha: BASE,
      trigger: 'opened',
      attempt: 1,
    });
  });

  it('resumes a run that was interrupted mid-review at the same attempt', async () => {
    const repo = await createRepo();
    const pull = await openPull(repo);
    await startRun(repo.repositoryId, pull.id, HEAD);

    await reconcile();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ headSha: HEAD, attempt: 1 });
  });

  it('leaves alone a PR whose head already has a finished review, a draft, and a disabled repo', async () => {
    const reviewedRepo = await createRepo();
    const reviewed = await openPull(reviewedRepo);
    const run = await startRun(reviewedRepo.repositoryId, reviewed.id, HEAD);
    await reviewRuns.fail(run.id, { code: 'test', message: 'finished' });

    await openPull(await createRepo(), { isDraft: true });
    await openPull(await createRepo({ isEnabled: false }));

    await reconcile();

    expect(enqueued).toEqual([]);
  });

  it('reviews a recorded push incrementally when its job was lost', async () => {
    const repo = await createRepo();
    const pull = await openPull(repo, { live: { headSha: NEWER_HEAD } });
    const run = await startRun(repo.repositoryId, pull.id, HEAD);
    await reviewRuns.fail(run.id, { code: 'test', message: 'finished' });
    await pullRequests.setLastReviewedSha(repo.repositoryId, 1, HEAD);
    // The synchronize webhook recorded the new head, then Redis went away with its job.
    await pullRequests.upsertIfNewer({
      repositoryId: repo.repositoryId,
      number: 1,
      title: 'Fix refund rounding',
      authorLogin: 'rohan-mehta',
      baseRef: 'main',
      headRef: 'fix-refund-rounding',
      headSha: NEWER_HEAD,
      state: 'open',
      isDraft: false,
      githubUpdatedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    });

    await reconcile();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ headSha: NEWER_HEAD, trigger: 'synchronize' });
  });

  it('skips a PR that GitHub says is closed, even if the stored row says open', async () => {
    const repo = await createRepo();
    await openPull(repo, { live: { state: 'closed' } });

    await expect(reconcile()).resolves.toMatchObject({ enqueued: 0, failed: 0 });
  });
});
