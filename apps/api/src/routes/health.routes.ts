import { Router } from 'express';

import { createGetReady, getHealth } from '../controllers/health.controller.js';
import type { ReadinessCheck } from '../services/readiness.service.js';

export function createHealthRouter(checks: readonly ReadinessCheck[]): Router {
  const router = Router();
  router.get('/health', getHealth);
  router.get('/ready', createGetReady(checks));
  return router;
}
