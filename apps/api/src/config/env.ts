import {
  LogLevelSchema,
  MongoUriSchema,
  NodeEnvSchema,
  RedisUrlSchema,
  parseEnv,
} from '@mergemind/shared';
import { z } from 'zod';

const DEFAULT_API_PORT = 4000;
const MAX_PORT = 65_535;
const MIN_WEBHOOK_SECRET_LENGTH = 16;

export const ApiEnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: LogLevelSchema,
  API_PORT: z.coerce.number().int().min(1).max(MAX_PORT).default(DEFAULT_API_PORT),
  MONGODB_URI: MongoUriSchema,
  REDIS_URL: RedisUrlSchema,
  GITHUB_WEBHOOK_SECRET: z.string().min(MIN_WEBHOOK_SECRET_LENGTH),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(ApiEnvSchema, source);
}
