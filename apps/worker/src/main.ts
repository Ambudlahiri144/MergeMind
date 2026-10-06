import {
  connectMongo,
  createCodeChunksRepository,
  createFindingsRepository,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  createSuppressionsRepository,
  createUsageLedgerRepository,
  disconnectMongo,
  ensureDbIndexes,
  ensureVectorSearchIndex,
} from '@mergemind/db';
import { createGithubApp, type GithubApp } from '@mergemind/github';
import {
  createEmbedder,
  createLangfuseTracer,
  createProviderChain,
  createReviewLlm,
  noopTracer,
  type Embedder,
  type LlmTracer,
} from '@mergemind/llm';
import { QUEUE_NAMES, registerGracefulShutdown, type ShutdownStep } from '@mergemind/shared';
import { createLogger, type Logger } from '@mergemind/shared/logger';
import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { loadWorkerEnv, type WorkerEnv } from './config/env.js';
import { smokeTestGrammars } from './indexing/chunker/tree-sitter.js';
import { DEFAULT_PIPELINE_CONFIG, type ReviewDeps } from './pipeline/types.js';
import { createIndexProcessor } from './processors/index.processor.js';
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

/** Built once and shared by the review and index workers. */
type SharedServices = { github: GithubApp; embedder: Embedder };

function buildReviewDeps(workerEnv: WorkerEnv, shared: SharedServices, log: Logger): ReviewDeps {
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
    codeChunks: createCodeChunksRepository(),
    embedder: shared.embedder,
    github: shared.github,
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

function startReviewWorker(connection: Redis, shared: SharedServices): Worker {
  const worker = new Worker(
    QUEUE_NAMES.review,
    createReviewProcessor(buildReviewDeps(env, shared, logger)),
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

/**
 * The code index (PRD F6). Disabled, with a reason in the log, when the bundled grammars cannot
 * load; a missing vector index only disables retrieval, not indexing (ADR-024).
 */
async function startIndexWorker(connection: Redis, shared: SharedServices): Promise<Worker | null> {
  try {
    await smokeTestGrammars();
  } catch (error) {
    logger.error({ err: error }, 'index.disabled');
    return null;
  }
  const vectorIndex = await ensureVectorSearchIndex();
  logger.info(vectorIndex, 'index.vectorSearchIndex');
  const worker = new Worker(
    QUEUE_NAMES.index,
    createIndexProcessor({
      installations: createInstallationsRepository(),
      repositories: createRepositoriesRepository(),
      codeChunks: createCodeChunksRepository(),
      usageLedger: createUsageLedgerRepository(),
      github: shared.github,
      embedder: shared.embedder,
      logger,
      now: () => new Date(),
      limits: { maxFiles: env.INDEX_MAX_FILES, maxFileBytes: env.INDEX_MAX_FILE_BYTES },
    }),
    { connection, concurrency: env.INDEX_CONCURRENCY },
  );
  worker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id, attemptsMade: job?.attemptsMade }, 'index.failed');
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

  const workers: { name: string; worker: Worker }[] = [];
  if (env.GITHUB_APP_ID === undefined || env.GITHUB_APP_PRIVATE_KEY === undefined) {
    // Jobs wait in Redis until the App is configured; nothing is lost.
    logger.warn({ reason: 'github_app_not_configured' }, 'review.disabled');
  } else {
    const shared: SharedServices = {
      github: createGithubApp({
        appId: env.GITHUB_APP_ID,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
        logger,
      }),
      embedder: createEmbedder({ ollamaBaseUrl: env.OLLAMA_BASE_URL, model: env.EMBEDDING_MODEL }),
    };
    workers.push({ name: 'review-worker', worker: startReviewWorker(connection, shared) });
    const indexWorker = await startIndexWorker(connection, shared);
    if (indexWorker !== null) {
      workers.push({ name: 'index-worker', worker: indexWorker });
    }
  }
  // The `ci-summary` processor registers here in Phase 5.
  logger.info(
    {
      workers: workers.map(({ name }) => name),
      concurrency: {
        review: env.REVIEW_CONCURRENCY,
        index: env.INDEX_CONCURRENCY,
        ciSummary: env.CI_SUMMARY_CONCURRENCY,
      },
    },
    'worker.started',
  );

  // close() waits for in-flight jobs to finish (Architecture.md §3).
  const steps: ShutdownStep[] = workers.map(({ name, worker }) => ({
    name,
    run: () => worker.close(),
  }));
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
