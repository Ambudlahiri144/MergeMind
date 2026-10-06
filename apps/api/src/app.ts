import { API_BASE_PATH, WEBHOOK_PATH } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createApiRouter, type ApiRouterDeps } from './routes/api.routes.js';
import { createHealthRouter } from './routes/health.routes.js';
import type { ReadinessCheck } from './services/readiness.service.js';
import type { WebhookControllerDeps } from './webhooks/webhook.controller.js';
import { createWebhookRouter } from './webhooks/webhook.routes.js';

const JSON_BODY_LIMIT = '1mb';

export type AppDependencies = {
  logger: Logger;
  readinessChecks: readonly ReadinessCheck[];
  webhook: WebhookControllerDeps;
  /** The authenticated `/api/v1` routes; omitted in tests that only exercise webhooks. */
  api?: ApiRouterDeps;
};

/** Builds the Express app without binding a port, so tests can drive it with Supertest. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.use(helmet());
  app.use(createRequestLogger(deps.logger));

  // Raw-body webhook route first: HMAC is computed over the exact bytes GitHub sent.
  app.use(WEBHOOK_PATH, createWebhookRouter(deps.webhook));

  const api = express.Router();
  api.use(express.json({ limit: JSON_BODY_LIMIT }));
  api.use(createHealthRouter(deps.readinessChecks));
  if (deps.api) {
    api.use(createApiRouter(deps.api));
  }
  app.use(API_BASE_PATH, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
