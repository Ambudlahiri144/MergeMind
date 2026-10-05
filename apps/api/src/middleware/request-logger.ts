import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@mergemind/shared';
import type { Logger } from '@mergemind/shared/logger';
import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';

// Accept a caller's id only if it is short and log-safe; otherwise mint our own.
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (candidate !== undefined && SAFE_REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }
  return `req_${randomUUID()}`;
}

/**
 * Assigns `req.id` (accepted or generated), echoes it in `x-request-id`, and gives every
 * log line from `req.log` a `requestId` field (Architecture.md §5, rules.md §5).
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    quietReqLogger: true,
    customAttributeKeys: { reqId: 'requestId' },
    // Keep access logs to IDs and outcomes; headers and bodies stay out of logs (rules.md §5).
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    genReqId: (req, res) => {
      const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader(REQUEST_ID_HEADER, requestId);
      return requestId;
    },
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) {
        return 'error';
      }
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
    customSuccessMessage: () => 'request.completed',
    customErrorMessage: () => 'request.failed',
  });
}
