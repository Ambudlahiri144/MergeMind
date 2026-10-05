import express, { Router } from 'express';

import { createWebhookController, type WebhookControllerDeps } from './webhook.controller.js';

/** GitHub caps webhook payloads at 25 MB. */
const WEBHOOK_BODY_LIMIT = '25mb';

/**
 * Raw bytes for every content type: the HMAC must be computed over exactly what GitHub sent,
 * so this router mounts before any JSON parser (rules.md §8).
 */
export function createWebhookRouter(deps: WebhookControllerDeps): Router {
  const router = Router();
  router.post(
    '/',
    express.raw({ type: () => true, limit: WEBHOOK_BODY_LIMIT }),
    createWebhookController(deps),
  );
  return router;
}
