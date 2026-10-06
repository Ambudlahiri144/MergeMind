import { RateLimitedError } from '@mergemind/shared';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

export type RateLimitOptions = {
  limit: number;
  /** Shared counters across api instances; omitted in unit tests (in-memory store). */
  redis?: Redis;
  /** Redis key prefix; tests use a unique one. */
  prefix?: string;
};

/**
 * Per-user limit on `/api/v1` (Architecture.md §5), after `authenticate` so the key is the
 * GitHub user id, never an IP. Exceeding it is a 429 problem+json with `Retry-After`.
 */
export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const { redis } = options;
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `user:${String(req.user?.githubUserId ?? 'anonymous')}`,
    ...(redis === undefined
      ? {}
      : {
          store: new RedisStore({
            prefix: options.prefix ?? 'rl:api:',
            sendCommand: (command: string, ...args: string[]) =>
              redis.call(command, ...args) as Promise<RedisReply>,
          }),
        }),
    handler: (_req, _res, next) => {
      next(new RateLimitedError('Too many requests, slow down', WINDOW_MS / 1000));
    },
  });
}
