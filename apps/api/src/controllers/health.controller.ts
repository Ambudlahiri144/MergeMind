import type { RequestHandler } from 'express';

import { checkReadiness, type ReadinessCheck } from '../services/readiness.service.js';

const HTTP_SERVICE_UNAVAILABLE = 503;

export const getHealth: RequestHandler = (_req, res) => {
  res.json({ status: 'ok' });
};

export function createGetReady(checks: readonly ReadinessCheck[]): RequestHandler {
  return async (req, res) => {
    const report = await checkReadiness(checks);
    if (!report.isReady) {
      req.log.warn({ checks: report.checks }, 'readiness.failed');
    }
    res
      .status(report.isReady ? 200 : HTTP_SERVICE_UNAVAILABLE)
      .json({ status: report.isReady ? 'ready' : 'not_ready', checks: report.checks });
  };
}
