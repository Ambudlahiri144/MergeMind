import { UnauthorizedError } from '@mergemind/shared';
import type { RequestHandler } from 'express';

import { apiTokenKey, verifyApiToken } from '../auth/api-token.js';

const BEARER_PREFIX = 'Bearer ';

/** Requires `Authorization: Bearer <web-minted JWT>` and sets `req.user` (ADR-029). */
export function authenticate(secret: string): RequestHandler {
  const key = apiTokenKey(secret);
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError('A valid bearer token is required');
    }
    req.user = await verifyApiToken(header.slice(BEARER_PREFIX.length).trim(), key);
    next();
  };
}
