import { randomUUID } from 'node:crypto';

import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { connectMongo, disconnectMongo } from '../../src/connection.js';
import { ensureDbIndexes } from '../../src/indexes.js';
import {
  createFindingsRepository,
  type NewFinding,
} from '../../src/repositories/findings.repository.js';
import { createReviewRunsRepository } from '../../src/repositories/review-runs.repository.js';
import { createSuppressionsRepository } from '../../src/repositories/suppressions.repository.js';
import { createUsageLedgerRepository } from '../../src/repositories/usage-ledger.repository.js';

const runs = createReviewRunsRepository();
const findings = createFindingsRepository();
const suppressions = createSuppressionsRepository();
const usage = createUsageLedgerRepository();

const newId = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

function startInput(repositoryId: string, headSha: string) {
  return {
    repositoryId,
    pullRequestId: newId(),
    headSha,
    baseSha: '0'.repeat(40),
    trigger: 'opened' as const,
    attempt: 1,
    promptVersion: 'security@2+correctness@2+maintainability@2',
  };
}

describe('reviewRuns', () => {
  it('creates a run once and resumes it for the same repo, SHA and attempt', async () => {
    const input = startInput(newId(), 'a'.repeat(40));

    const first = await runs.startOrResume(input);
    await runs.setCheckRunId(first.run.id, 991);
    const second = await runs.startOrResume(input);

    expect(first.isNew).toBe(true);
    expect(first.run).toMatchObject({ status: 'running', mode: 'full', attempt: 1 });
    expect(second.isNew).toBe(false);
    expect(second.run).toMatchObject({ id: first.run.id, checkRunId: 991 });
  });

  it('starts a separate run for a manual rerun attempt', async () => {
    const input = startInput(newId(), 'b'.repeat(40));

    const first = await runs.startOrResume(input);
    const rerun = await runs.startOrResume({ ...input, attempt: 2 });

    expect(rerun.isNew).toBe(true);
    expect(rerun.run.id).not.toBe(first.run.id);
  });

  it('records analysis, completion and clears an earlier error', async () => {
    const { run } = await runs.startOrResume(startInput(newId(), 'c'.repeat(40)));
    const analyzedAt = new Date('2026-10-06T10:00:00Z');

    await runs.fail(run.id, { code: 'upstream', message: 'GitHub 502' });
    await runs.markAnalyzed(
      run.id,
      {
        mode: 'full',
        tokens: { input: 1200, output: 300 },
        counts: {
          critical: 1,
          major: 0,
          minor: 2,
          suppressed: 0,
          filtered: 1,
          duplicate: 0,
          merged: 0,
          resolved: 0,
        },
        failedPasses: ['maintainability'],
      },
      analyzedAt,
    );
    await runs.complete(run.id, {
      mode: 'full',
      gateConclusion: 'failure',
      counts: {
        critical: 1,
        major: 0,
        minor: 2,
        suppressed: 0,
        filtered: 1,
        duplicate: 0,
        merged: 0,
        resolved: 0,
      },
      timings: { queuedMs: 5, fetchMs: 10, retrieveMs: 0, llmMs: 900, publishMs: 40, totalMs: 960 },
      isBudgetWarning: true,
      policyErrors: [],
    });

    const stored = await runs.findById(run.id);
    expect(stored).toMatchObject({
      status: 'completed',
      gateConclusion: 'failure',
      analyzedAt,
      tokens: { input: 1200, output: 300 },
      failedPasses: ['maintainability'],
      isBudgetWarning: true,
    });
    expect(stored).not.toHaveProperty('error');
  });
});

describe('findings', () => {
  const finding = (overrides: Partial<NewFinding> = {}): NewFinding => ({
    pass: 'security',
    severity: 'critical',
    confidence: 0.9,
    category: 'injection',
    path: 'src/users.ts',
    lineStart: 10,
    lineEnd: 12,
    title: 'SQL injection',
    body: 'User input reaches the query.',
    suggestion: null,
    fingerprint: randomUUID(),
    state: 'open',
    placement: 'inline',
    ...overrides,
  });

  it('never stores the same fingerprint twice for a PR, across runs', async () => {
    const pullRequestId = newId();
    const repositoryId = newId();
    const shared = finding();

    const firstRun = await findings.insertForRun(
      { reviewRunId: newId(), pullRequestId, repositoryId },
      [shared, finding()],
    );
    const secondRun = await findings.insertForRun(
      { reviewRunId: newId(), pullRequestId, repositoryId },
      [shared],
    );

    expect(firstRun).toBe(2);
    expect(secondRun).toBe(0);
    expect(
      await findings.findExistingFingerprints(pullRequestId, [shared.fingerprint, 'unknown']),
    ).toEqual(new Set([shared.fingerprint]));
  });

  it('lists a run and stores the GitHub comment ids', async () => {
    const reviewRunId = newId();
    const inline = finding({ suggestion: 'use a parameterized query' });
    await findings.insertForRun({ reviewRunId, pullRequestId: newId(), repositoryId: newId() }, [
      inline,
      finding({ placement: 'summary', severity: 'minor' }),
    ]);

    await findings.setCommentIds(reviewRunId, [
      { fingerprint: inline.fingerprint, githubCommentId: 555 },
    ]);
    const listed = await findings.listForRun(reviewRunId);

    expect(listed).toHaveLength(2);
    expect(listed.find((f) => f.fingerprint === inline.fingerprint)).toMatchObject({
      githubCommentId: 555,
      suggestion: 'use a parameterized query',
      reviewRunId,
    });
  });
});

describe('suppressions', () => {
  it('suppresses idempotently and reports only suppressed fingerprints', async () => {
    const repositoryId = newId();
    const input = { repositoryId, fingerprint: 'fp-1', createdByLogin: 'dev-alice' };

    await suppressions.suppress(input);
    await suppressions.suppress({ ...input, createdByLogin: 'someone-else' });

    expect(await suppressions.findSuppressed(repositoryId, ['fp-1', 'fp-2'])).toEqual(
      new Set(['fp-1']),
    );
    expect(await suppressions.findSuppressed(newId(), ['fp-1'])).toEqual(new Set());
  });
});

describe('usageLedger', () => {
  it('sums input and output tokens per installation and period', async () => {
    const installationId = newId();
    const reviewRunId = newId();
    const row = {
      installationId,
      reviewRunId,
      kind: 'review' as const,
      provider: 'groq' as const,
      model: 'openai/gpt-oss-120b',
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 800,
      isFallback: false,
      period: '2026-10',
    };

    await usage.record([row, { ...row, provider: 'ollama', isFallback: true }]);
    await usage.record([
      { ...row, period: '2026-09' },
      { ...row, installationId: newId() },
    ]);

    expect(await usage.sumTokensForPeriod(installationId, '2026-10')).toBe(2400);
    expect(await usage.sumTokensForPeriod(installationId, '2026-11')).toBe(0);
    expect(await usage.countForRun(reviewRunId)).toBe(4);
  });
});
