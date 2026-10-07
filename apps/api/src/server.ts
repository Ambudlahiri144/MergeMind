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
  createWebhookDeliveriesRepository,
  disconnectMongo,
  ensureDbIndexes,
  pingMongo,
} from '@mergemind/db';
import { createGithubApp, type GithubApp } from '@mergemind/github';
import { BOOT_RECOVERY_DELAY_MS, registerGracefulShutdown } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import { Redis } from 'ioredis';

import { createApp } from './app.js';
import { loadApiEnv } from './config/env.js';
import { createCiSummaryProducer } from './queues/ci-summary.producer.js';
import { createIndexProducer } from './queues/index.producer.js';
import { createReviewProducer } from './queues/review.producer.js';
import { createAccessService } from './services/access.service.js';
import { redeliverFailedWebhooks } from './services/redelivery.service.js';
import { createWebhookService } from './services/webhook.service.js';

const env = loadApiEnv();
const logger = createLogger({ name: 'api', level: env.LOG_LEVEL });

async function main(): Promise<void> {
  await connectMongo(env.MONGODB_URI);
  await ensureDbIndexes();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on('error', (error) => {
    logger.warn({ err: error }, 'redis.connectionError');
  });

  const reviewProducer = createReviewProducer({ connection: redis });
  const indexProducer = createIndexProducer({ connection: redis });
  const ciSummaryProducer = createCiSummaryProducer({ connection: redis });
  const installations = createInstallationsRepository();
  const repositories = createRepositoriesRepository();
  const pullRequests = createPullRequestsRepository();
  const github: GithubApp | null =
    env.GITHUB_APP_ID === undefined || env.GITHUB_APP_PRIVATE_KEY === undefined
      ? null
      : createGithubApp({
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
          logger,
        });
  if (env.API_JWT_SECRET === undefined) {
    logger.warn({ reason: 'api_jwt_secret_missing' }, 'api.authDisabled');
  }
  const webhookService = createWebhookService({
    deliveries: createWebhookDeliveriesRepository(),
    installations,
    repositories,
    pullRequests,
    reviewProducer,
    indexProducer,
    ciSummaryProducer,
  });

  const app = createApp({
    logger,
    readinessChecks: [
      { name: 'mongo', check: pingMongo },
      {
        name: 'redis',
        check: async () => {
          await redis.ping();
        },
      },
    ],
    webhook: { secret: env.GITHUB_WEBHOOK_SECRET, service: webhookService },
    api: {
      jwtSecret: env.API_JWT_SECRET ?? null,
      rateLimit: { limit: env.API_RATE_LIMIT_PER_MINUTE, redis },
      access: createAccessService({
        installations,
        users: createUsersRepository(),
        github,
        logger,
        now: () => new Date(),
      }),
      stores: {
        installations,
        repositories,
        pullRequests,
        reviewRuns: createReviewRunsRepository(),
        findings: createFindingsRepository(),
        suppressions: createSuppressionsRepository(),
        usageLedger: createUsageLedgerRepository(),
      },
      github,
      reviewProducer,
      indexProducer,
      now: () => new Date(),
    },
  });

  const server = app.listen(env.API_PORT, (error) => {
    if (error) {
      logger.fatal({ err: error, port: env.API_PORT }, 'server.listenFailed');
      process.exit(1);
    }
    logger.info({ port: env.API_PORT }, 'server.started');
  });

  if (env.WEBHOOK_REDELIVERY_ON_BOOT && github !== null) {
    const appClient = github;
    setTimeout(() => {
      redeliverFailedWebhooks({ github: appClient, logger, now: () => new Date() }).catch(
        (error: unknown) => {
          logger.error({ err: error }, 'webhook.redeliveryPassFailed');
        },
      );
    }, BOOT_RECOVERY_DELAY_MS).unref();
  }

  registerGracefulShutdown(logger, [
    {
      name: 'http',
      run: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    },
    { name: 'review-queue', run: () => reviewProducer.close() },
    { name: 'index-queue', run: () => indexProducer.close() },
    { name: 'ci-summary-queue', run: () => ciSummaryProducer.close() },
    {
      name: 'redis',
      run: async () => {
        await redis.quit();
      },
    },
    { name: 'mongo', run: disconnectMongo },
  ]);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'server.startFailed');
  process.exit(1);
});
