import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { connectMongo, disconnectMongo } from '../../src/connection.js';
import { ensureDbIndexes } from '../../src/indexes.js';
import { createFindingsRepository } from '../../src/repositories/findings.repository.js';
import { createInstallationsRepository } from '../../src/repositories/installations.repository.js';
import { createPullRequestsRepository } from '../../src/repositories/pull-requests.repository.js';
import { createRepositoriesRepository } from '../../src/repositories/repositories.repository.js';
import { createReviewRunsRepository } from '../../src/repositories/review-runs.repository.js';
import { createUsersRepository } from '../../src/repositories/users.repository.js';

// Read models behind the web UI's API (Phase 6).
const installations = createInstallationsRepository();
const repositories = createRepositoriesRepository();
const pullRequests = createPullRequestsRepository();
const runs = createReviewRunsRepository();
const findings = createFindingsRepository();
const users = createUsersRepository();

let nextGithubId = 610_000;

beforeAll(async () => {
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

async function createInstallation(status: 'active' | 'suspended' = 'active') {
  nextGithubId += 1;
  return installations.upsertFromGithub({
    githubInstallationId: nextGithubId,
    accountLogin: `acct-${nextGithubId}`,
    accountType: 'Organization',
    status,
  });
}

async function createRepository(installationId: string, fullName: string) {
  nextGithubId += 1;
  return repositories.upsertForInstallation(installationId, {
    githubRepoId: nextGithubId,
    fullName,
    isPrivate: false,
  });
}

async function createPr(repositoryId: string, number: number, state: 'open' | 'closed' = 'open') {
  await pullRequests.upsertIfNewer({
    repositoryId,
    number,
    title: `PR ${number}`,
    authorLogin: 'ananya-iyer',
    baseRef: 'main',
    headRef: `feat-${number}`,
    headSha: String(number).padStart(40, 'a'),
    state,
    isDraft: false,
    githubUpdatedAt: new Date('2026-10-06T10:00:00Z'),
  });
  const pr = await pullRequests.findByNumber(repositoryId, number);
  if (!pr) {
    throw new Error('PR missing');
  }
  return pr;
}

describe('installations', () => {
  it('finds by id, lists only active ones and sets the budget', async () => {
    const active = await createInstallation();
    const suspended = await createInstallation('suspended');

    await installations.setBudget(active, 500_000);

    expect(await installations.findById(active)).toMatchObject({ monthlyTokenBudget: 500_000 });
    const listed = (await installations.listActive(100)).map((installation) => installation.id);
    expect(listed).toContain(active);
    expect(listed).not.toContain(suspended);
  });
});

describe('repositories', () => {
  it('pages an installation by name and toggles isEnabled', async () => {
    const installationId = await createInstallation();
    const ids = [];
    for (const name of ['c-api', 'a-web', 'b-docs']) {
      ids.push(await createRepository(installationId, `octo/${name}`));
    }

    const first = await repositories.listForInstallation(installationId, { limit: 2 });
    const last = first.at(-1);
    const second = await repositories.listForInstallation(installationId, {
      limit: 2,
      ...(last ? { after: { fullName: last.fullName, id: last.id } } : {}),
    });
    await repositories.setEnabled(ids[0] ?? '', false);

    expect(first.map((repo) => repo.fullName)).toEqual(['octo/a-web', 'octo/b-docs']);
    expect(second.map((repo) => repo.fullName)).toEqual(['octo/c-api']);
    expect((await repositories.findById(ids[0] ?? ''))?.isEnabled).toBe(false);
  });
});

describe('pullRequests', () => {
  it('pages a repository newest first, filters by state and counts open PRs', async () => {
    const installationId = await createInstallation();
    const repositoryId = await createRepository(installationId, 'octo/prs');
    for (const number of [1, 2, 3]) {
      await createPr(repositoryId, number, number === 2 ? 'closed' : 'open');
    }

    const all = await pullRequests.listForRepository(repositoryId, { limit: 2 });
    const tail = all.at(-1);
    const rest = await pullRequests.listForRepository(repositoryId, {
      limit: 2,
      ...(tail ? { before: { updatedAt: tail.updatedAt, id: tail.id } } : {}),
    });
    const open = await pullRequests.listForRepository(repositoryId, { state: 'open', limit: 10 });

    expect([...all, ...rest].map((pr) => pr.number)).toEqual([3, 2, 1]);
    expect(open.map((pr) => pr.number)).toEqual([3, 1]);
    expect((await pullRequests.countOpenByRepository([repositoryId])).get(repositoryId)).toBe(2);
    expect((await pullRequests.findById(open[0]?.id ?? ''))?.number).toBe(3);
  });
});

describe('reviewRuns read models', () => {
  it('lists runs newest first, finds the latest per PR, the max attempt and the last run', async () => {
    const installationId = await createInstallation();
    const repositoryId = await createRepository(installationId, 'octo/runs');
    const pr = await createPr(repositoryId, 7);
    const start = (attempt: number) =>
      runs.startOrResume({
        repositoryId,
        pullRequestId: pr.id,
        headSha: pr.headSha,
        baseSha: '0'.repeat(40),
        trigger: attempt > 1 ? 'manual' : 'opened',
        attempt,
        promptVersion: 'security@2',
      });

    const first = await start(1);
    const second = await start(2);

    expect((await runs.listForPr(pr.id, 10)).map((run) => run.attempt)).toEqual([2, 1]);
    expect((await runs.latestForPrs([pr.id])).get(pr.id)?.id).toBe(second.run.id);
    expect(await runs.maxAttempt(repositoryId, pr.headSha)).toBe(2);
    expect(await runs.maxAttempt(repositoryId, 'f'.repeat(40))).toBe(0);
    expect((await runs.lastRunAtByRepository([repositoryId])).get(repositoryId)).toEqual(
      second.run.createdAt,
    );
    expect(first.run.createdAt).toBeInstanceOf(Date);
  });
});

describe('reviewRuns written before newer count fields existed', () => {
  it('reads missing counts and timings as 0', async () => {
    // Live 2026-10-07: a Phase 3 run had no counts.resolved/merged, and the web's schema
    // rejected the PR list. Lean reads skip Mongoose defaults, so the view must fill them.
    const pullRequestId = new mongoose.Types.ObjectId();
    const { insertedId } = await mongoose.connection.collection('reviewRuns').insertOne({
      pullRequestId,
      repositoryId: new mongoose.Types.ObjectId(),
      headSha: '9'.repeat(40),
      baseSha: '8'.repeat(40),
      trigger: 'opened',
      mode: 'full',
      status: 'completed',
      counts: { critical: 1, major: 0, minor: 0, suppressed: 0, filtered: 0, duplicate: 0 },
      tokens: { input: 0, output: 0 },
      timings: { queuedMs: 1, fetchMs: 1, llmMs: 1, publishMs: 1, totalMs: 4 },
      promptVersion: 'security@1',
      attempt: 1,
      isBudgetWarning: false,
      policyErrors: [],
      failedPasses: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const run = await runs.findById(insertedId.toString());
    const [listed] = await runs.listForPr(pullRequestId.toString(), 1);

    expect(run?.counts).toMatchObject({ critical: 1, resolved: 0, merged: 0 });
    expect(run?.timings.retrieveMs).toBe(0);
    expect(listed?.counts.resolved).toBe(0);
  });
});

describe('findings dismiss', () => {
  it('dismisses an open finding once and reports its scope', async () => {
    const repositoryId = new mongoose.Types.ObjectId().toString();
    const pullRequestId = new mongoose.Types.ObjectId().toString();
    const reviewRunId = new mongoose.Types.ObjectId().toString();
    await findings.insertForRun({ reviewRunId, pullRequestId, repositoryId }, [
      {
        pass: 'security',
        severity: 'critical',
        confidence: 0.9,
        category: 'hardcoded-secret',
        path: 'src/a.ts',
        lineStart: 2,
        lineEnd: 2,
        title: 'Key in source',
        body: 'b',
        suggestion: null,
        fingerprint: 'f'.repeat(64),
        state: 'open',
        placement: 'inline',
      },
    ]);
    const [stored] = await findings.listForRun(reviewRunId);

    const firstDismiss = await findings.dismiss(stored?.id ?? '');
    const secondDismiss = await findings.dismiss(stored?.id ?? '');

    expect([firstDismiss, secondDismiss]).toEqual([true, false]);
    expect(await findings.findById(stored?.id ?? '')).toMatchObject({
      state: 'dismissed',
      pullRequestId,
      repositoryId,
    });
    expect(await findings.countOpenBySeverity(pullRequestId)).toMatchObject({ critical: 0 });
  });
});

describe('users access cache', () => {
  it('creates a user on first save and replaces the access list later', async () => {
    const installationId = await createInstallation();
    const checkedAt = new Date('2026-10-06T12:00:00Z');

    await users.saveAccess({
      githubUserId: 90001,
      login: 'rohan-mehta',
      access: [{ installationId, role: 'admin' }],
      checkedInstallationIds: [installationId],
      checkedAt,
    });
    await users.saveAccess({
      githubUserId: 90001,
      login: 'rohan-mehta',
      access: [],
      checkedInstallationIds: [installationId],
      checkedAt,
    });

    expect(await users.findByGithubUserId(90001)).toEqual({
      githubUserId: 90001,
      login: 'rohan-mehta',
      access: [],
      checkedInstallationIds: [installationId],
      accessCheckedAt: checkedAt,
    });
    expect(await users.findByGithubUserId(1)).toBeNull();
  });
});
