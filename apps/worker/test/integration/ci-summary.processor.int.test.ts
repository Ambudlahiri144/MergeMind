import { randomUUID } from 'node:crypto';

import {
  connectMongo,
  createInstallationsRepository,
  createRepositoriesRepository,
  createUsageLedgerRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import { createGithubApp, extractCiRun } from '@mergemind/github';
import { createFakeGithub, createTestPrivateKey, type FakeJob } from '@mergemind/github/testing';
import {
  LlmUnavailableError,
  isProviderAllowed,
  type CiSummaryInput,
  type CiSummaryLlm,
} from '@mergemind/llm';
import { usagePeriod, type CiSummaryJobData, type LlmProviderName } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import mongoose from 'mongoose';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from 'vitest';

import { runCiSummary, type CiSummaryDeps } from '../../src/ci/run-ci-summary.js';

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
const usageLedger = createUsageLedgerRepository();
const NOW = new Date('2026-10-06T12:00:00Z');

const HEAD_SHA = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';
const TS = '2026-10-06T10:00:00.0000000Z ';
const FAILED_LOG = [
  `${TS}##[group]Run npm test`,
  `${TS}npm test`,
  `${TS}##[endgroup]`,
  `${TS}FAIL src/refund.test.ts`,
  `${TS}AssertionError: expected 10 to be 9.99`,
  `${TS}##[error]Process completed with exit code 1.`,
].join('\n');

type FakeLlm = CiSummaryLlm & { inputs: CiSummaryInput[] };

/** Applies the real provider allowlist; `fail` simulates every provider being down. */
function createFakeLlm(options: { provider?: LlmProviderName; fail?: boolean } = {}): FakeLlm {
  const provider = options.provider ?? 'groq';
  const inputs: CiSummaryInput[] = [];
  const call = {
    provider,
    model: `${provider}-model`,
    inputTokens: 500,
    outputTokens: 60,
    latencyMs: 900,
    isFallback: false,
    outcome: 'ok' as const,
  };
  return {
    inputs,
    summarize(input) {
      if (!isProviderAllowed(provider, input)) {
        return Promise.reject(new LlmUnavailableError('ci-summary', []));
      }
      inputs.push(input);
      if (options.fail) {
        return Promise.reject(
          new LlmUnavailableError('ci-summary', [{ ...call, outcome: 'error' }]),
        );
      }
      return Promise.resolve({
        summary: {
          failingStep: 'test / Run npm test',
          likelyCause: 'Refund rounding changed: the test expects 9.99 but gets 10.',
          evidenceLines: [5],
          suggestedFix: 'Round to two decimals.',
          confidence: 0.85,
        },
        calls: [call],
        promptVersion: 'ci-summary@1',
        provider,
      });
    },
  };
}

function buildDeps(llm: CiSummaryLlm): CiSummaryDeps {
  return { installations, repositories, usageLedger, github, llm, logger, now: () => NOW };
}

const meta = (isFinalAttempt = true) => ({ jobId: 'job-1', isFinalAttempt });

let nextId = 850_000;

type Scenario = { fullName: string; installationId: string; data: CiSummaryJobData };

async function createScenario(
  options: {
    isPrivate?: boolean;
    allowedProviders?: LlmProviderName[];
    prNumbers?: number[];
    budget?: number;
  } = {},
): Promise<Scenario> {
  nextId += 1;
  const githubInstallationId = nextId;
  const githubRepoId = nextId + 100_000;
  const fullName = `octo-demo/ci-${nextId}`;
  const installationId = await installations.upsertFromGithub({
    githubInstallationId,
    accountLogin: 'octo-demo',
    accountType: 'Organization',
    status: 'active',
  });
  const overrides = {
    ...(options.allowedProviders ? { allowedProviders: options.allowedProviders } : {}),
    ...(options.budget === undefined ? {} : { monthlyTokenBudget: options.budget }),
  };
  if (Object.keys(overrides).length > 0) {
    await mongoose.connection
      .collection('installations')
      .updateOne({ githubInstallationId }, { $set: overrides });
  }
  await repositories.upsertForInstallation(installationId, {
    githubRepoId,
    fullName,
    isPrivate: options.isPrivate ?? false,
    defaultBranch: 'main',
  });
  const job: FakeJob = {
    id: nextId,
    name: 'test',
    conclusion: 'failure',
    html_url: `https://github.com/${fullName}/actions/runs/1/job/${nextId}`,
    steps: [
      { name: 'Set up job', number: 1, conclusion: 'success' },
      { name: 'Run npm test', number: 2, conclusion: 'failure' },
    ],
  };
  fakeGithub.runJobs.set(`${fullName}:${nextId}@1`, [job]);
  fakeGithub.jobLogs.set(`${fullName}:${job.id}`, FAILED_LOG);
  fakeGithub.pullStates.set(`${fullName}#42`, { state: 'open', headSha: HEAD_SHA });
  const data: CiSummaryJobData = {
    githubInstallationId,
    githubRepoId,
    repoFullName: fullName,
    isPrivate: options.isPrivate ?? false,
    workflowRunId: nextId,
    workflowId: 66600001,
    workflowName: 'CI',
    runNumber: 57,
    runAttempt: 1,
    headSha: HEAD_SHA,
    headBranch: 'fix-refunds',
    htmlUrl: `https://github.com/${fullName}/actions/runs/${nextId}`,
    outcome: 'failed',
    prNumbers: options.prNumbers ?? [42],
  };
  return { fullName, installationId, data };
}

function commentsFor(scenario: Scenario) {
  return fakeGithub.issueComments.filter((comment) => comment.repo === scenario.fullName);
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await connectMongo(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
  await ensureDbIndexes();
});

afterEach(() => {
  fakeGithub.reset();
});

afterAll(async () => {
  server.close();
  await mongoose.connection.dropDatabase();
  await disconnectMongo();
});

describe('ci-summary.run (PRD F10)', () => {
  it('fetches the failed log and posts one comment citing its lines', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm();

    const outcome = await runCiSummary(scenario.data, meta(), buildDeps(llm));

    expect(outcome).toEqual({
      status: 'completed',
      mode: 'analysed',
      comments: [{ prNumber: 42, action: 'created' }],
    });
    const [comment] = commentsFor(scenario);
    expect(comment?.body).toContain('**Likely cause:** Refund rounding changed');
    expect(comment?.body).toContain('test, line 5: `AssertionError: expected 10 to be 9.99`');
    expect(comment?.body).toContain('5 | AssertionError');
    expect(llm.inputs[0]?.excerpts[0]).toMatchObject({ jobName: 'test', stepName: 'Run npm test' });
    expect(await usageLedger.sumTokensForPeriod(scenario.installationId, usagePeriod(NOW))).toBe(
      560,
    );
  });

  it('never posts a second comment when the same run attempt is processed again', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm();

    await runCiSummary(scenario.data, meta(), buildDeps(llm));
    const again = await runCiSummary(scenario.data, meta(), buildDeps(llm));

    expect(again).toMatchObject({ comments: [{ prNumber: 42, action: 'unchanged' }] });
    expect(commentsFor(scenario)).toHaveLength(1);
    expect(llm.inputs).toHaveLength(1);
  });

  it('updates the same comment for a re-run attempt, and ignores a late older attempt', async () => {
    const scenario = await createScenario();
    const rerun = { ...scenario.data, runAttempt: 2 };
    fakeGithub.runJobs.set(
      `${scenario.fullName}:${scenario.data.workflowRunId}@2`,
      fakeGithub.runJobs.get(`${scenario.fullName}:${scenario.data.workflowRunId}@1`) ?? [],
    );

    await runCiSummary(scenario.data, meta(), buildDeps(createFakeLlm()));
    await runCiSummary(rerun, meta(), buildDeps(createFakeLlm()));
    const late = await runCiSummary(scenario.data, meta(), buildDeps(createFakeLlm()));

    const comments = commentsFor(scenario);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.editCount).toBe(1);
    expect(extractCiRun(comments[0]?.body)).toMatchObject({ attempt: 2, outcome: 'failed' });
    expect(late).toMatchObject({ comments: [{ action: 'unchanged' }] });
  });

  it('marks the comment passing when the workflow later succeeds, without an LLM call', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm();
    await runCiSummary(scenario.data, meta(), buildDeps(llm));

    const passed = await runCiSummary(
      { ...scenario.data, workflowRunId: scenario.data.workflowRunId + 1, outcome: 'passed' },
      meta(),
      buildDeps(llm),
    );

    expect(passed).toMatchObject({ mode: 'passed', comments: [{ action: 'updated' }] });
    expect(commentsFor(scenario)[0]?.body).toContain('is passing again');
    expect(llm.inputs).toHaveLength(1);
  });

  it('posts nothing for a success on a PR that never failed', async () => {
    const scenario = await createScenario();

    await runCiSummary({ ...scenario.data, outcome: 'passed' }, meta(), buildDeps(createFakeLlm()));

    expect(commentsFor(scenario)).toEqual([]);
  });

  it('finds a fork PR by its head commit', async () => {
    const scenario = await createScenario({ prNumbers: [] });
    fakeGithub.commitPulls.set(`${scenario.fullName}:${HEAD_SHA}`, [
      { number: 42, state: 'open', headSha: HEAD_SHA },
    ]);

    const outcome = await runCiSummary(scenario.data, meta(), buildDeps(createFakeLlm()));

    expect(outcome).toMatchObject({ comments: [{ prNumber: 42, action: 'created' }] });
  });

  it('skips a run whose PR head moved on', async () => {
    const scenario = await createScenario();
    fakeGithub.pullStates.set(`${scenario.fullName}#42`, {
      state: 'open',
      headSha: 'f'.repeat(40),
    });

    const outcome = await runCiSummary(scenario.data, meta(), buildDeps(createFakeLlm()));

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_open_pr_at_head' });
    expect(commentsFor(scenario)).toEqual([]);
  });

  it('never sends a private repo log outside the allowlist: excerpt-only comment', async () => {
    const scenario = await createScenario({ isPrivate: true, allowedProviders: ['groq'] });
    const llm = createFakeLlm({ provider: 'gemini' });

    const outcome = await runCiSummary(scenario.data, meta(false), buildDeps(llm));

    expect(outcome).toMatchObject({ mode: 'logs_only', comments: [{ action: 'created' }] });
    expect(llm.inputs).toEqual([]);
    expect(commentsFor(scenario)[0]?.body).toContain('No AI provider is allowed');
  });

  it('shows the excerpt only, without an LLM call, when the budget is used up', async () => {
    const scenario = await createScenario({ budget: 1 });
    await usageLedger.record([
      {
        installationId: scenario.installationId,
        kind: 'review',
        provider: 'groq',
        model: 'groq-model',
        inputTokens: 5,
        outputTokens: 0,
        latencyMs: 1,
        isFallback: false,
        period: usagePeriod(NOW),
      },
    ]);
    const llm = createFakeLlm();

    const outcome = await runCiSummary(scenario.data, meta(), buildDeps(llm));

    expect(outcome).toMatchObject({ mode: 'logs_only' });
    expect(llm.inputs).toEqual([]);
    expect(commentsFor(scenario)[0]?.body).toContain('token budget is used up');
  });

  it('retries a provider outage, then posts the excerpt on the last attempt', async () => {
    const scenario = await createScenario();
    const llm = createFakeLlm({ fail: true });

    await expect(runCiSummary(scenario.data, meta(false), buildDeps(llm))).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
    const last = await runCiSummary(scenario.data, meta(true), buildDeps(llm));

    expect(commentsFor(scenario)).toHaveLength(1);
    expect(last).toMatchObject({ mode: 'logs_only', comments: [{ action: 'created' }] });
  });

  it('says so when the logs expired', async () => {
    const scenario = await createScenario();
    fakeGithub.jobLogs.clear();

    await runCiSummary(scenario.data, meta(), buildDeps(createFakeLlm()));

    expect(commentsFor(scenario)[0]?.body).toContain('no longer available');
  });

  it('respects ciSummary.enabled: false in .mergemind.yml', async () => {
    const scenario = await createScenario();
    fakeGithub.fileContents.set(
      `${scenario.fullName}@main:.mergemind.yml`,
      'version: 1\nciSummary:\n  enabled: false\n',
    );

    const outcome = await runCiSummary(scenario.data, meta(), buildDeps(createFakeLlm()));

    expect(outcome).toEqual({ status: 'skipped', reason: 'ci_summary_disabled' });
  });

  it('escalates a public repo to private when the job says so (ADR-027)', async () => {
    const scenario = await createScenario({ isPrivate: false });

    await runCiSummary({ ...scenario.data, isPrivate: true }, meta(), buildDeps(createFakeLlm()));

    expect((await repositories.findByGithubRepoId(scenario.data.githubRepoId))?.isPrivate).toBe(
      true,
    );
  });
});
