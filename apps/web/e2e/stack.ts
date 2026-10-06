// The whole stack for Playwright (Testing.md §1 E2E): Mongo + Redis containers, seeded data,
// the real api in-process (no GitHub App, so policy and snippets show their error state), and
// `next dev` with the E2E sign-in seam (ADR-029). Playwright starts this as its webServer.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  connectMongo,
  createFindingsRepository,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  createSuppressionsRepository,
  createUsageLedgerRepository,
  createUsersRepository,
  disconnectMongo,
  ensureDbIndexes,
} from '@mergemind/db';
import { usagePeriod } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import { Redis } from 'ioredis';
import { GenericContainer, Wait } from 'testcontainers';

import { createApp } from '../../api/src/app.js';
import { createIndexProducer } from '../../api/src/queues/index.producer.js';
import { createReviewProducer } from '../../api/src/queues/review.producer.js';
import { createAccessService } from '../../api/src/services/access.service.js';
import {
  E2E_API_JWT_SECRET,
  E2E_API_PORT,
  E2E_AUTH_SECRET,
  E2E_CRITICAL_TITLE,
  E2E_EMPTY_REPO,
  E2E_MINOR_TITLE,
  E2E_PR_NUMBER,
  E2E_REPO,
  E2E_USER,
  E2E_WEB_PORT,
} from './constants.js';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logger = createLogger({ name: 'e2e-api', level: 'fatal' });
const HEAD = 'c3d4e5f60718293a4b5c6d7e8f9012345678901a';

async function seed() {
  const installations = createInstallationsRepository();
  const repositories = createRepositoriesRepository();
  const pullRequests = createPullRequestsRepository();
  const runs = createReviewRunsRepository();
  const findings = createFindingsRepository();
  const usage = createUsageLedgerRepository();

  const installationId = await installations.upsertFromGithub({
    githubInstallationId: 9_100_001,
    accountLogin: E2E_USER.login,
    accountType: 'User',
    status: 'active',
  });
  const repositoryId = await repositories.upsertForInstallation(installationId, {
    githubRepoId: 9_200_001,
    fullName: E2E_REPO,
    isPrivate: false,
    defaultBranch: 'main',
  });
  await repositories.upsertForInstallation(installationId, {
    githubRepoId: 9_200_002,
    fullName: E2E_EMPTY_REPO,
    isPrivate: true,
    defaultBranch: 'main',
  });
  await pullRequests.upsertIfNewer({
    repositoryId,
    number: E2E_PR_NUMBER,
    title: 'Fix refund rounding',
    authorLogin: 'rohan-mehta',
    baseRef: 'main',
    headRef: 'fix-refund-rounding',
    headSha: HEAD,
    state: 'open',
    isDraft: false,
    githubUpdatedAt: new Date('2026-10-06T10:00:00Z'),
  });
  const pr = await pullRequests.findByNumber(repositoryId, E2E_PR_NUMBER);
  if (!pr) {
    throw new Error('seeded PR missing');
  }
  const { run } = await runs.startOrResume({
    repositoryId,
    pullRequestId: pr.id,
    headSha: HEAD,
    baseSha: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
    trigger: 'opened',
    attempt: 1,
    promptVersion: 'security@2+correctness@2+maintainability@2',
  });
  const base = {
    confidence: 0.92,
    path: 'src/refunds.ts',
    suggestion: null,
    state: 'open' as const,
  };
  await findings.insertForRun({ reviewRunId: run.id, pullRequestId: pr.id, repositoryId }, [
    {
      ...base,
      pass: 'security',
      severity: 'critical',
      category: 'hardcoded-secret',
      lineStart: 4,
      lineEnd: 4,
      title: E2E_CRITICAL_TITLE,
      body: 'A live API key is committed. Anyone with read access can use it.',
      suggestion: 'const key = process.env.PAYMENT_API_KEY;',
      fingerprint: 'a'.repeat(64),
      placement: 'inline',
    },
    {
      ...base,
      pass: 'maintainability',
      severity: 'minor',
      category: 'other',
      lineStart: 10,
      lineEnd: 12,
      title: E2E_MINOR_TITLE,
      body: 'The name suggests a read, but the helper also writes to the ledger.',
      fingerprint: 'b'.repeat(64),
      placement: 'summary',
    },
  ]);
  await runs.complete(run.id, {
    mode: 'full',
    gateConclusion: 'failure',
    counts: {
      critical: 1,
      major: 0,
      minor: 1,
      suppressed: 0,
      filtered: 0,
      duplicate: 0,
      merged: 0,
      resolved: 0,
    },
    timings: {
      queuedMs: 400,
      fetchMs: 300,
      retrieveMs: 200,
      llmMs: 9000,
      publishMs: 500,
      totalMs: 10400,
    },
    isBudgetWarning: false,
    policyErrors: [],
  });
  await usage.record([
    {
      installationId,
      repositoryId,
      kind: 'review',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      inputTokens: 1_100_000,
      outputTokens: 140_000,
      latencyMs: 9000,
      isFallback: false,
      period: usagePeriod(new Date()),
    },
  ]);
}

async function main() {
  const [mongo, redisContainer] = await Promise.all([
    new GenericContainer('mongodb/mongodb-atlas-local:8.0')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(150_000)
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);
  await connectMongo(
    `mongodb://${mongo.getHost()}:${String(mongo.getMappedPort(27017))}/mergemind_e2e?directConnection=true`,
  );
  await ensureDbIndexes();
  await seed();

  const redis = new Redis(
    `redis://${redisContainer.getHost()}:${String(redisContainer.getMappedPort(6379))}`,
    { maxRetriesPerRequest: null },
  );
  const installations = createInstallationsRepository();
  const app = createApp({
    logger,
    readinessChecks: [],
    webhook: {
      secret: 'e2e-webhook-secret-unused',
      service: { process: () => Promise.reject(new Error('webhooks are not part of E2E')) },
    },
    api: {
      jwtSecret: E2E_API_JWT_SECRET,
      rateLimit: { limit: 10_000, redis },
      access: createAccessService({
        installations,
        users: createUsersRepository(),
        github: null,
        logger,
        now: () => new Date(),
      }),
      stores: {
        installations,
        repositories: createRepositoriesRepository(),
        pullRequests: createPullRequestsRepository(),
        reviewRuns: createReviewRunsRepository(),
        findings: createFindingsRepository(),
        suppressions: createSuppressionsRepository(),
        usageLedger: createUsageLedgerRepository(),
      },
      github: null,
      reviewProducer: createReviewProducer({ connection: redis, prefix: 'e2e' }),
      indexProducer: createIndexProducer({ connection: redis, prefix: 'e2e' }),
      now: () => new Date(),
    },
  });
  const apiServer = app.listen(E2E_API_PORT);

  const web = spawn('npx', ['next', 'dev', '--port', String(E2E_WEB_PORT)], {
    cwd: webDir,
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MERGEMIND_E2E: '1',
      API_BASE_URL: `http://localhost:${String(E2E_API_PORT)}`,
      API_JWT_SECRET: E2E_API_JWT_SECRET,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      BETTER_AUTH_URL: `http://localhost:${String(E2E_WEB_PORT)}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });

  let isStopping = false;
  const stop = async () => {
    if (isStopping) {
      return;
    }
    isStopping = true;
    web.kill();
    apiServer.close();
    await redis.quit().catch(() => undefined);
    await disconnectMongo();
    await Promise.all([mongo.stop(), redisContainer.stop()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  web.on('exit', () => void stop());
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'e2e.stackFailed');
  process.exit(1);
});
