import { z } from 'zod';

export const NodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const LogLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

export const MongoUriSchema = z.url({ protocol: /^mongodb(\+srv)?$/ });

export const RedisUrlSchema = z.url({ protocol: /^rediss?$/ });

/** Env flags arrive as strings; accept the usual spellings. */
export const BooleanFlagSchema = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses env once at boot (rules.md §3). Throws an `EnvValidationError` naming every
 * missing or invalid variable, and never echoes variable values (they may be secrets).
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined> = process.env,
): z.infer<Schema> {
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  const result = schema.safeParse(normalized);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new EnvValidationError(issues);
}
