import { randomUUID } from 'node:crypto';

import {
  createFindingsRepository,
  createInstallationsRepository,
  createPullRequestsRepository,
  createRepositoriesRepository,
  createReviewRunsRepository,
  createSuppressionsRepository,
  createUsageLedgerRepository,
  createUsersRepository,
} from '@mergemind/db';
import { createGithubApp, type GithubApp } from '@mergemind/github';
import { createTestPrivateKey } from '@mergemind/github/testing';
import { createLogger } from '@mergemind/shared/logger';
import { TEST_WEBHOOK_SECRET } from '@mergemind/shared/testing';
import type { Redis } from 'ioredis';

import { createApp } from '../../src/app.js';
import { createIndexProducer } from '../../src/queues/index.producer.js';
import { createReviewProducer } from '../../src/queues/review.producer.js';
import type { ApiRouterDeps } from '../../src/routes/api.routes.js';
import { createAccessService } from '../../src/services/access.service.js';
import type { ApiStores } from '../../src/services/scope.service.js';
import type { WebhookService } from '../../src/services/webhook.service.js';
import { TEST_API_JWT_SECRET } from './api-token.js';

export const testLogger = createLogger({ name: 'test', level: 'silent' });

export function createTestStores(): ApiStores {
  return {
    installations: createInstallationsRepository(),
    repositories: createRepositoriesRepository(),
    pullRequests: createPullRequestsRepository(),
    reviewRuns: createReviewRunsRepository(),
    findings: createFindingsRepository(),
    suppressions: createSuppressionsRepository(),
    usageLedger: createUsageLedgerRepository(),
  };
}

/** A GitHub App client pointed at `createFakeGithub()` handlers (MSW). */
export function createTestGithub(appId = 5150): GithubApp {
  return createGithubApp({
    appId,
    privateKey: createTestPrivateKey(),
    logger: testLogger,
    retries: 0,
    isThrottled: false,
  });
}

const unusedWebhooks: WebhookService = {
  process: () => Promise.reject(new Error('webhooks are not used in this test')),
};

/** The real app with the authenticated API on real Mongo + Redis (Testing.md §4). */
export function buildApiApp(options: {
  redis: Redis;
  github: GithubApp | null;
  now?: () => Date;
  /** BullMQ key prefix for the producers (each test file uses its own). */
  queuePrefix?: string;
  overrides?: Partial<ApiRouterDeps>;
}) {
  const stores = createTestStores();
  const now = options.now ?? (() => new Date());
  const queuePrefix = options.queuePrefix ?? `test-${randomUUID()}`;
  return createApp({
    logger: testLogger,
    readinessChecks: [],
    webhook: { secret: TEST_WEBHOOK_SECRET, service: unusedWebhooks },
    api: {
      jwtSecret: TEST_API_JWT_SECRET,
      rateLimit: { limit: 1000, redis: options.redis, prefix: `rl-${randomUUID()}:` },
      access: createAccessService({
        installations: stores.installations,
        users: createUsersRepository(),
        github: options.github,
        logger: testLogger,
        now,
      }),
      stores,
      github: options.github,
      reviewProducer: createReviewProducer({ connection: options.redis, prefix: queuePrefix }),
      indexProducer: createIndexProducer({ connection: options.redis, prefix: queuePrefix }),
      now,
      ...options.overrides,
    },
  });
}

/** MSW option: Supertest talks to the app over loopback; anything else unhandled fails. */
export const failOnExternalRequests = {
  onUnhandledRequest: (req: Request, print: { error(): void }) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(req.url).hostname)) {
      print.error();
    }
  },
};
