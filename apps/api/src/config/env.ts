import {
  LogLevelSchema,
  MIN_API_JWT_SECRET_LENGTH,
  MongoUriSchema,
  NodeEnvSchema,
  RedisUrlSchema,
  parseEnv,
} from '@mergemind/shared';
import { z } from 'zod';

const DEFAULT_API_PORT = 4000;
const MAX_PORT = 65_535;
const MIN_WEBHOOK_SECRET_LENGTH = 16;

const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

export const ApiEnvSchema = z
  .object({
    NODE_ENV: NodeEnvSchema,
    LOG_LEVEL: LogLevelSchema,
    API_PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_API_PORT),
    MONGODB_URI: MongoUriSchema,
    REDIS_URL: RedisUrlSchema,
    GITHUB_WEBHOOK_SECRET: z.string().min(MIN_WEBHOOK_SECRET_LENGTH),
    // web -> api tokens (ADR-029); without it the authenticated routes answer 503.
    API_JWT_SECRET: z.string().min(MIN_API_JWT_SECRET_LENGTH).optional(),
    API_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_RATE_LIMIT_PER_MINUTE),
    // GitHub App: org-membership checks, policy and snippets (ADR-030); optional like the worker.
    GITHUB_APP_ID: z.coerce.number().int().positive().optional(),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .min(1)
      .transform((pem) => pem.replace(/\\n/g, '\n'))
      .optional(),
  })
  .refine(
    (env) => (env.GITHUB_APP_ID === undefined) === (env.GITHUB_APP_PRIVATE_KEY === undefined),
    {
      message: 'Set both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or neither',
      path: ['GITHUB_APP_ID'],
    },
  );

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(ApiEnvSchema, source);
}
