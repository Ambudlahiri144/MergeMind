import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createFindingsRepository,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  createSuppressionsRepository,
  createUsageLedgerRepository,
  disconnectMongo,
  ensureDbIndexes,
  type ReviewRunsRepository,
} from '@mergemind/db';
import { createGithubApp, extractFingerprint } from '@mergemind/github';
import { createFakeGithub, createTestPrivateKey } from '@mergemind/github/testing';
import { LlmUnavailableError, type ReviewLlm, type ReviewPassInput } from '@mergemind/llm';
import {
  JOB_NAMES,
  QUEUE_JOB_OPTIONS,
  QUEUE_NAMES,
  usagePeriod,
  type CandidateFinding,
  type ReviewPass,
  type ReviewPrJobData,
} from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

import { runReview } from '../../src/pipeline/run-review.js';
import {
  DEFAULT_PIPELINE_CONFIG,
  ReviewRetryableError,
  type ReviewDeps,
} from '../../src/pipeline/types.js';
import { createReviewProcessor } from '../../src/processors/review.processor.js';

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PATCH = [
  '@@ -1,4 +1,7 @@',
  ' import { db } from "./db";',
  ' export async function findUser(id: string) {',
  '-  return db.users.findOne({ id });',
  '+  const sql = "SELECT * FROM users WHERE id = \'" + id + "\'";',
  '+  const rows = await db.query(sql);',
  '+  return rows[0].email;',
  ' }',
  '+export const VERSION = 2;',
].join('\n');

const fakeGithub = createFakeGithub();
const server = setupServer(...fakeGithub.handlers);
const logger = createLogger({ name: 'test', level: 'silent' });
const github = createGithubApp({
  appId: 4242,
  privateKey: createTestPrivateKey(),
  logger,
  retries: 0,
});

const repos = {
  installations: createInstallationsRepository(),
  repositories: createRepositoriesRepository(),
  pullRequests: createPullRequestsRepository(),
  reviewRuns: createReviewRunsRepository(),
  findings: createFindingsRepository(),
  suppressions: createSuppressionsRepository(),
  usageLedger: createUsageLedgerRepository(),
};

type Script = Partial<Record<ReviewPass, Omit<CandidateFinding, 'pass'>[] | 'fail'>>;

/** Deterministic ReviewLlm: returns scripted findings per pass and records every call. */
function createFakeLlm(script: Script): ReviewLlm & { calls: ReviewPassInput[] } {
  const calls: ReviewPassInput[] = [];
  const callRecord = {
    provider: 'groq' as const,
    model: 'fake-model',
    inputTokens: 1000,
    outputTokens: 100,
    latencyMs: 5,
    isFallback: false,
    outcome: 'ok' as const,
  };
  return {
    calls,
    reviewPass(input) {
      calls.push(input);
      const scripted = script[input.pass];
      if (scripted === 'fail') {
        return Promise.reject(
          new LlmUnavailableError(input.pass, [
            { ...callRecord, outcome: 'error', inputTokens: 0, outputTokens: 0 },
          ]),
        );
      }
      return Promise.resolve({
        pass: input.pass,
        findings: (scripted ?? []).map((finding) => ({ ...finding, pass: input.pass })),
        calls: [callRecord],
        promptVersion: `${input.pass}@1`,
        provider: 'groq' as const,
      });
    },
  };
}

const SQL_INJECTION = {
  severity: 'critical' as const,
  confidence: 0.95,
  category: 'injection' as const,
  path: 'src/users.ts',
  lineStart: 3,
  lineEnd: 4,
  title: 'SQL injection in findUser',
  body: 'The id is concatenated into SQL.',
  suggestion: 'await db.query("SELECT * FROM users WHERE id = $1", [id]);',
};
const NULL_DEREF_OUTSIDE_DIFF = {
  severity: 'major' as const,
  confidence: 0.85,
  category: 'null-deref' as const,
  path: 'src/users.ts',
  lineStart: 40,
  lineEnd: 41,
  title: 'Caller ignores a null user',
  body: 'Outside the changed lines.',
  suggestion: null,
};
const NAMING_NIT = {
  severity: 'minor' as const,
  confidence: 0.75,
  category: 'other' as const,
  path: 'src/users.ts',
  lineStart: 6,
  lineEnd: 6,
  title: 'Exported constant needs a comment',
  body: 'Explain what VERSION versions.',
  suggestion: null,
};
const LOW_CONFIDENCE = { ...NAMING_NIT, title: 'Maybe rename', confidence: 0.3 };

let nextId = 700_000;

type Scenario = {
  installationId: number;
  repoId: number;
  repoFullName: string;
  data: ReviewPrJobData;
};

/** A fresh installation, repo and PR so tests never share state. */
async function createScenario(
  options: { isDraft?: boolean; policy?: string } = {},
): Promise<Scenario> {
  nextId += 1;
  const installationId = nextId;
  const repoId = nextId + 500_000;
  const repoFullName = `octo-demo/repo-${nextId}`;
  await repos.installations.upsertFromGithub({
    githubInstallationId: installationId,
    accountLogin: 'octo-demo',
    accountType: 'Organization',
    status: 'active',
  });
  fakeGithub.pullRequestFiles.set(`${repoFullName}#7`, [
    { filename: 'src/users.ts', status: 'modified', additions: 4, deletions: 1, patch: PATCH },
    { filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0 },
    {
      filename: 'package-lock.json',
      status: 'modified',
      additions: 900,
      deletions: 900,
      patch: '@@ -1 +1 @@\n-a\n+b',
    },
  ]);
  if (options.policy !== undefined) {
    fakeGithub.fileContents.set(`${repoFullName}@${HEAD_SHA}:.mergemind.yml`, options.policy);
  }
  return {
    installationId,
    repoId,
    repoFullName,
    data: {
      deliveryId: randomUUID(),
      githubInstallationId: installationId,
      githubRepoId: repoId,
      repoFullName,
      isPrivate: false,
      defaultBranch: 'main',
      prNumber: 7,
      title: 'Add user lookup',
      authorLogin: 'dev-alice',
      baseRef: 'main',
      headRef: 'feat/users',
      baseSha: '0'.repeat(40),
      headSha: HEAD_SHA,
      isDraft: options.isDraft ?? false,
      trigger: 'opened',
      githubUpdatedAt: '2026-10-06T10:00:00Z',
    },
  };
}

function buildDeps(llm: ReviewLlm, overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    ...repos,
    github,
    llm,
    logger,
    now: () => new Date(),
    config: DEFAULT_PIPELINE_CONFIG,
    ...overrides,
  };
}

const meta = (isFinalAttempt = true) => ({
  jobId: randomUUID(),
  enqueuedAt: Date.now(),
  isFinalAttempt,
});
const reviewsFor = (scenario: Scenario) =>
  fakeGithub.reviews.filter((review) => review.repo === scenario.repoFullName);
const checksFor = (scenario: Scenario) =>
  fakeGithub.checkRuns.filter((check) => check.repo === scenario.repoFullName);

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

afterAll(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('review pipeline end to end', () => {
  it('posts one review, gates the check, and records findings and usage', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm({
      security: [SQL_INJECTION],
      correctness: [NULL_DEREF_OUTSIDE_DIFF],
      maintainability: [NAMING_NIT, LOW_CONFIDENCE],
    });

    const outcome = await runReview(scenario.data, meta(), buildDeps(llm));

    expect(outcome).toMatchObject({ status: 'completed', mode: 'full', gateConclusion: 'failure' });
    const reviews = reviewsFor(scenario);
    expect(reviews).toHaveLength(1);
    const review = reviews[0];
    // Only the anchored critical goes inline; the fake GitHub would 422 an off-diff comment.
    expect(review?.comments).toEqual([
      expect.objectContaining({ path: 'src/users.ts', line: 4, start_line: 3 }),
    ]);
    expect(review?.body).toContain('Outside the changed lines');
    expect(review?.body).toContain('Exported constant needs a comment');
    expect(review?.body).toContain('Not reviewed (binary or too large to diff): `assets/logo.png`');
    expect(review?.body).not.toContain('package-lock.json');
    expect(checksFor(scenario)).toEqual([
      expect.objectContaining({ status: 'completed', conclusion: 'failure', headSha: HEAD_SHA }),
    ]);
    expect(llm.calls.map((call) => call.pass).sort()).toEqual([
      'correctness',
      'maintainability',
      'security',
    ]);

    const runId = outcome.runId ?? '';
    expect(await repos.reviewRuns.findById(runId)).toMatchObject({
      status: 'completed',
      counts: { critical: 1, major: 1, minor: 1, filtered: 1, suppressed: 0, duplicate: 0 },
      tokens: { input: 3000, output: 300 },
      promptVersion: 'security@1+correctness@1+maintainability@1',
    });
    const stored = await repos.findings.listForRun(runId);
    expect(stored).toHaveLength(4);
    const inline = stored.find((finding) => finding.placement === 'inline');
    expect(inline?.githubCommentId).toBe(review?.comments[0]?.id);
    expect(extractFingerprint(review?.comments[0]?.body)).toBe(inline?.fingerprint);
    expect(await repos.usageLedger.countForRun(runId)).toBe(3);
    const repositoryId = (await repos.repositories.findIdByGithubRepoId(scenario.repoId)) ?? '';
    const pullRequest = await mongoose.connection
      .collection('pullRequests')
      .findOne({ repositoryId: new mongoose.Types.ObjectId(repositoryId), number: 7 });
    expect(pullRequest?.lastReviewedSha).toBe(HEAD_SHA);
  });

  it('replays a finished job without a second review or LLM call', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm({ security: [SQL_INJECTION] });
    await runReview(scenario.data, meta(), buildDeps(llm));

    const replay = await runReview(scenario.data, meta(), buildDeps(llm));

    expect(replay.status).toBe('replayed');
    expect(reviewsFor(scenario)).toHaveLength(1);
    expect(checksFor(scenario)).toHaveLength(1);
    expect(llm.calls).toHaveLength(3);
  });

  it('adopts the posted review after a crash right after createReview (no duplicate)', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm({ security: [SQL_INJECTION] });
    let isCrashPending = true;
    const crashingRuns: ReviewRunsRepository = {
      ...repos.reviewRuns,
      setGithubReviewId: (runId, reviewId) => {
        if (isCrashPending) {
          isCrashPending = false;
          return Promise.reject(new Error('worker killed'));
        }
        return repos.reviewRuns.setGithubReviewId(runId, reviewId);
      },
    };
    const deps = buildDeps(llm, { reviewRuns: crashingRuns });

    await expect(runReview(scenario.data, meta(false), deps)).rejects.toThrow('worker killed');
    const retry = await runReview(scenario.data, meta(), deps);

    expect(retry.status).toBe('completed');
    expect(reviewsFor(scenario)).toHaveLength(1);
    expect(checksFor(scenario)).toHaveLength(1);
    expect(llm.calls).toHaveLength(3);
    expect((await repos.reviewRuns.findById(retry.runId ?? ''))?.githubReviewId).toBe(
      reviewsFor(scenario)[0]?.id,
    );
  });

  it('never posts a finding twice when the same issue survives a new push', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm({ security: [SQL_INJECTION] });
    await runReview(scenario.data, meta(), buildDeps(llm));

    const second = await runReview(
      {
        ...scenario.data,
        headSha: 'b'.repeat(40),
        trigger: 'synchronize',
        githubUpdatedAt: '2026-10-06T11:00:00Z',
      },
      meta(),
      buildDeps(llm),
    );

    expect(reviewsFor(scenario)).toHaveLength(1);
    // Still present, so the gate still fails; the run records it as already reported.
    expect(second.gateConclusion).toBe('failure');
    expect((await repos.reviewRuns.findById(second.runId ?? ''))?.counts).toMatchObject({
      critical: 1,
      duplicate: 1,
    });
  });

  it('skips with a neutral check and no LLM calls when the budget is used up', async () => {
    const scenario = await createScenario();
    const installationId =
      (await repos.installations.findIdByGithubId(scenario.installationId)) ?? '';
    await repos.usageLedger.record([
      {
        installationId,
        kind: 'review',
        provider: 'groq',
        model: 'm',
        inputTokens: 2_000_000,
        outputTokens: 0,
        latencyMs: 1,
        isFallback: false,
        period: usagePeriod(new Date()),
      },
    ]);
    const llm = createFakeLlm({ security: [SQL_INJECTION] });

    const outcome = await runReview(scenario.data, meta(), buildDeps(llm));

    expect(outcome).toMatchObject({
      status: 'skipped',
      skipReason: 'budget_exhausted',
      gateConclusion: 'neutral',
    });
    expect(llm.calls).toHaveLength(0);
    expect(checksFor(scenario)[0]).toMatchObject({
      conclusion: 'neutral',
      output: { title: 'Skipped: monthly token budget used up' },
    });
  });

  it('silently skips a draft, then reviews it when it is marked ready', async () => {
    const scenario = await createScenario({ isDraft: true });
    const llm = createFakeLlm({ security: [SQL_INJECTION] });

    const draft = await runReview(scenario.data, meta(), buildDeps(llm));
    const checksWhileDraft = checksFor(scenario).length;
    const ready = await runReview(
      {
        ...scenario.data,
        isDraft: false,
        trigger: 'ready_for_review',
        githubUpdatedAt: '2026-10-06T10:05:00Z',
      },
      meta(),
      buildDeps(llm),
    );

    expect(draft).toMatchObject({ status: 'skipped', skipReason: 'draft' });
    expect(checksWhileDraft).toBe(0);
    expect(ready).toMatchObject({ status: 'completed', gateConclusion: 'failure' });
    expect(checksFor(scenario)).toHaveLength(1);
  });

  it('applies defaults and reports an invalid .mergemind.yml', async () => {
    const scenario = await createScenario({ policy: 'gate:\n  failOn: sometimes\n' });
    const llm = createFakeLlm({ security: [SQL_INJECTION] });

    const outcome = await runReview(scenario.data, meta(), buildDeps(llm));

    expect(outcome.gateConclusion).toBe('failure');
    expect(reviewsFor(scenario)[0]?.body).toContain(
      'Invalid `.mergemind.yml`, defaults applied: gate.failOn',
    );
  });

  it('honours a valid policy: only the configured passes and gate', async () => {
    const scenario = await createScenario({
      policy: 'review:\n  passes: [security]\ngate:\n  failOn: never\n',
    });
    const llm = createFakeLlm({ security: [SQL_INJECTION] });

    const outcome = await runReview(scenario.data, meta(), buildDeps(llm));

    expect(llm.calls.map((call) => call.pass)).toEqual(['security']);
    expect(outcome.gateConclusion).toBe('success');
  });

  it('posts only a notice for a PR above maxChangedLines', async () => {
    const scenario = await createScenario({ policy: 'review:\n  maxChangedLines: 3\n' });
    const llm = createFakeLlm({ security: [SQL_INJECTION] });

    const outcome = await runReview(scenario.data, meta(), buildDeps(llm));

    expect(outcome).toMatchObject({ mode: 'summary_only', gateConclusion: 'neutral' });
    expect(llm.calls).toHaveLength(0);
    expect(reviewsFor(scenario)[0]?.comments).toEqual([]);
    expect(reviewsFor(scenario)[0]?.body).toContain('skipped the line-by-line review');
  });

  it('skips a superseded SHA without a check run', async () => {
    const scenario = await createScenario();
    const installationId =
      (await repos.installations.findIdByGithubId(scenario.installationId)) ?? '';
    const repositoryId = await repos.repositories.upsertForInstallation(installationId, {
      githubRepoId: scenario.repoId,
      fullName: scenario.repoFullName,
      isPrivate: false,
    });
    await repos.pullRequests.upsertIfNewer({
      repositoryId,
      number: 7,
      title: 't',
      authorLogin: 'dev-alice',
      baseRef: 'main',
      headRef: 'feat/users',
      headSha: 'c'.repeat(40),
      state: 'open',
      isDraft: false,
      githubUpdatedAt: new Date('2026-10-06T12:00:00Z'),
    });

    const outcome = await runReview(scenario.data, meta(), buildDeps(createFakeLlm({})));

    expect(outcome).toMatchObject({ status: 'skipped', skipReason: 'superseded' });
    expect(checksFor(scenario)).toHaveLength(0);
  });

  it('retries when every provider fails, then closes the check as unavailable on the last attempt', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm({ security: 'fail', correctness: 'fail', maintainability: 'fail' });

    await expect(runReview(scenario.data, meta(false), buildDeps(llm))).rejects.toBeInstanceOf(
      ReviewRetryableError,
    );
    const last = await runReview(scenario.data, meta(true), buildDeps(llm));

    expect(last).toMatchObject({ gateConclusion: 'neutral', mode: 'full' });
    expect(checksFor(scenario)).toHaveLength(1);
    expect(checksFor(scenario)[0]).toMatchObject({
      conclusion: 'neutral',
      output: { title: 'Review unavailable: no LLM provider responded' },
    });
    expect(reviewsFor(scenario)).toHaveLength(0);
  });

  it('resolves an installation it has never seen through the GitHub API', async () => {
    const scenario = await createScenario();
    const unknownId = scenario.installationId + 9_000_000;
    fakeGithub.installations.set(unknownId, { login: 'late-org', type: 'Organization' });

    await runReview(
      {
        ...scenario.data,
        githubInstallationId: unknownId,
        githubRepoId: scenario.repoId + 250_000,
      },
      meta(),
      buildDeps(createFakeLlm({})),
    );

    expect(await repos.installations.findByGithubId(unknownId)).toMatchObject({
      accountLogin: 'late-org',
      status: 'active',
    });
  });
});

describe('review.pr processor through BullMQ', () => {
  const connections: Redis[] = [];
  const newConnection = () => {
    const connection = new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
    connections.push(connection);
    return connection;
  };
  let queue: Queue;
  let queueEvents: QueueEvents;
  let worker: Worker;

  beforeAll(async () => {
    const prefix = `test-${randomUUID()}`;
    queue = new Queue(QUEUE_NAMES.review, { connection: newConnection(), prefix });
    queueEvents = new QueueEvents(QUEUE_NAMES.review, { connection: newConnection(), prefix });
    worker = new Worker(
      QUEUE_NAMES.review,
      createReviewProcessor(buildDeps(createFakeLlm({ security: [SQL_INJECTION] }))),
      { connection: newConnection(), prefix },
    );
    await queueEvents.waitUntilReady();
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await queue.close();
    await Promise.all(connections.map((connection) => connection.quit()));
  });

  it('runs a valid job to completion', async () => {
    const scenario = await createScenario();

    const job = await queue.add(JOB_NAMES.reviewPr, scenario.data, {
      ...QUEUE_JOB_OPTIONS.review,
      jobId: randomUUID(),
    });
    const result: unknown = await job.waitUntilFinished(queueEvents);

    expect(result).toMatchObject({ status: 'completed', gateConclusion: 'failure' });
  });

  it('fails invalid job data once, without retries', async () => {
    const jobId = `invalid-${randomUUID()}`;
    const job = await queue.add(
      JOB_NAMES.reviewPr,
      { prNumber: 'seven' },
      { ...QUEUE_JOB_OPTIONS.review, jobId },
    );

    await expect(job.waitUntilFinished(queueEvents)).rejects.toThrow(/Invalid review.pr job data/);

    const stored = await queue.getJob(jobId);
    expect(await stored?.getState()).toBe('failed');
    expect(stored?.attemptsMade).toBe(1);
  });
});
