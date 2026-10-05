import {
  connectMongo,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createWebhookDeliveriesRepository,
  disconnectMongo,
  ensureDbIndexes,
  pingMongo,
} from '@mergemind/db';
import { registerGracefulShutdown } from '@mergemind/shared';
import { createLogger } from '@mergemind/shared/logger';
import { Redis } from 'ioredis';

import { createApp } from './app.js';
import { loadApiEnv } from './config/env.js';
import { createReviewProducer } from './queues/review.producer.js';
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
  const webhookService = createWebhookService({
    deliveries: createWebhookDeliveriesRepository(),
    installations: createInstallationsRepository(),
    repositories: createRepositoriesRepository(),
    pullRequests: createPullRequestsRepository(),
    reviewProducer,
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
  });

  const server = app.listen(env.API_PORT, (error) => {
    if (error) {
      logger.fatal({ err: error, port: env.API_PORT }, 'server.listenFailed');
      process.exit(1);
    }
    logger.info({ port: env.API_PORT }, 'server.started');
  });

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
