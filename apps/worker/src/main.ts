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
} from '@mergemind/db';
import { createGithubApp } from '@mergemind/github';
import {
  createLangfuseTracer,
  createProviderChain,
  createReviewLlm,
  noopTracer,
  type LlmTracer,
} from '@mergemind/llm';
import { QUEUE_NAMES, registerGracefulShutdown, type ShutdownStep } from '@mergemind/shared';
import { createLogger, type Logger } from '@mergemind/shared/logger';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadWorkerEnv, type WorkerEnv } from './config/env.js';
import { DEFAULT_PIPELINE_CONFIG, type ReviewDeps } from './pipeline/types.js';
import { createReviewProcessor } from './processors/review.processor.js';
import { createWorkerRedisConnection } from './queues/connection.js';

const env = loadWorkerEnv();
const logger = createLogger({ name: 'worker', level: env.LOG_LEVEL });

/** Langfuse when both keys are set (ADR-010, ADR-022); otherwise a no-op. */
function createTracer(workerEnv: WorkerEnv, log: Logger): LlmTracer {
  if (workerEnv.LANGFUSE_PUBLIC_KEY === undefined || workerEnv.LANGFUSE_SECRET_KEY === undefined) {
    log.info({ isEnabled: false }, 'llm.tracingConfigured');
    return noopTracer;
  }
  log.info(
    {
      isEnabled: true,
      baseUrl: workerEnv.LANGFUSE_BASE_URL,
      isRedactingPrivateInputs: workerEnv.LANGFUSE_REDACT_INPUTS,
    },
    'llm.tracingConfigured',
  );
  return createLangfuseTracer({
    publicKey: workerEnv.LANGFUSE_PUBLIC_KEY,
    secretKey: workerEnv.LANGFUSE_SECRET_KEY,
    baseUrl: workerEnv.LANGFUSE_BASE_URL,
    isRedactingPrivateInputs: workerEnv.LANGFUSE_REDACT_INPUTS,
    environment: workerEnv.NODE_ENV,
    logger: log,
  });
}

const tracer = createTracer(env, logger);

function buildReviewDeps(
  workerEnv: WorkerEnv,
  appId: number,
  privateKey: string,
  log: Logger,
): ReviewDeps {
  const providers = createProviderChain({
    ollamaBaseUrl: workerEnv.OLLAMA_BASE_URL,
    primaryModel: workerEnv.LLM_PRIMARY_MODEL,
    localModel: workerEnv.LLM_LOCAL_MODEL,
    ...(workerEnv.GROQ_API_KEY === undefined ? {} : { groqApiKey: workerEnv.GROQ_API_KEY }),
    ...(workerEnv.GOOGLE_GENERATIVE_AI_API_KEY === undefined ||
    workerEnv.LLM_FALLBACK_MODEL === undefined
      ? {}
      : {
          googleApiKey: workerEnv.GOOGLE_GENERATIVE_AI_API_KEY,
          fallbackModel: workerEnv.LLM_FALLBACK_MODEL,
        }),
  });
  log.info(
    { providers: providers.map((provider) => `${provider.name}:${provider.modelId}`) },
    'llm.chainConfigured',
  );
  return {
    installations: createInstallationsRepository(),
    repositories: createRepositoriesRepository(),
    pullRequests: createPullRequestsRepository(),
    reviewRuns: createReviewRunsRepository(),
    findings: createFindingsRepository(),
    suppressions: createSuppressionsRepository(),
    usageLedger: createUsageLedgerRepository(),
    github: createGithubApp({ appId, privateKey, logger: log }),
    llm: createReviewLlm({ providers, timeoutMs: workerEnv.LLM_TIMEOUT_MS, logger: log, tracer }),
    logger: log,
    now: () => new Date(),
    config: {
      ...DEFAULT_PIPELINE_CONFIG,
      chunkTokens: workerEnv.LLM_CHUNK_TOKENS,
      passConcurrency: workerEnv.LLM_PASS_CONCURRENCY,
    },
  };
}

function startReviewWorker(connection: Redis): Worker | null {
  if (env.GITHUB_APP_ID === undefined || env.GITHUB_APP_PRIVATE_KEY === undefined) {
    // Jobs wait in Redis until the App is configured; nothing is lost.
    logger.warn({ reason: 'github_app_not_configured' }, 'review.disabled');
    return null;
  }
  const worker = new Worker(
    QUEUE_NAMES.review,
    createReviewProcessor(
      buildReviewDeps(env, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, logger),
    ),
    { connection, concurrency: env.REVIEW_CONCURRENCY },
  );
  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id, attemptsMade: job?.attemptsMade }, 'review.failed');
  });
  worker.on('error', (error) => {
    logger.error({ err: error }, 'worker.error');
  });
  return worker;
}

async function main(): Promise<void> {
  await connectMongo(env.MONGODB_URI);
  await ensureDbIndexes();
  const connection = createWorkerRedisConnection(env.REDIS_URL);
  connection.on('error', (error) => {
    logger.warn({ err: error }, 'redis.connectionError');
  });
  await connection.ping();

  const reviewWorker = startReviewWorker(connection);
  // `index` and `ci-summary` processors register here in Phases 4 and 5.
  logger.info(
    {
      isReviewEnabled: reviewWorker !== null,
      concurrency: {
        review: env.REVIEW_CONCURRENCY,
        index: env.INDEX_CONCURRENCY,
        ciSummary: env.CI_SUMMARY_CONCURRENCY,
      },
    },
    'worker.started',
  );

  const steps: ShutdownStep[] = [];
  if (reviewWorker !== null) {
    // close() waits for in-flight jobs to finish (Architecture.md §3).
    steps.push({ name: 'review-worker', run: () => reviewWorker.close() });
  }
  // After the worker: in-flight reviews may still record spans while closing.
  steps.push({ name: 'llm-tracer', run: () => tracer.shutdown() });
  steps.push(
    {
      name: 'redis',
      run: async () => {
        await connection.quit();
      },
    },
    { name: 'mongo', run: disconnectMongo },
  );
  registerGracefulShutdown(logger, steps);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'worker.startFailed');
  process.exit(1);
});
