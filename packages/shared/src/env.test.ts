import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BooleanFlagSchema, EnvValidationError, LogLevelSchema, parseEnv } from './env.js';

const TestEnvSchema = z.object({
  LOG_LEVEL: LogLevelSchema,
  MONGODB_URI: z.url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  IS_ENABLED: BooleanFlagSchema.default(false),
});

describe('parseEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = parseEnv(TestEnvSchema, { MONGODB_URI: 'mongodb://localhost:27017' });

    expect(env).toEqual({
      LOG_LEVEL: 'info',
      MONGODB_URI: 'mongodb://localhost:27017',
      API_PORT: 4000,
      IS_ENABLED: false,
    });
  });

  it('treats empty strings as missing so .env placeholders fall back to defaults', () => {
    const env = parseEnv(TestEnvSchema, { MONGODB_URI: 'mongodb://localhost', API_PORT: '' });

    expect(env.API_PORT).toBe(4000);
  });

  it('coerces numbers and boolean flags', () => {
    const env = parseEnv(TestEnvSchema, {
      MONGODB_URI: 'mongodb://localhost',
      API_PORT: '5000',
      IS_ENABLED: '1',
    });

    expect(env.API_PORT).toBe(5000);
    expect(env.IS_ENABLED).toBe(true);
  });

  it('names every invalid variable without echoing values', () => {
    const parse = () =>
      parseEnv(TestEnvSchema, { MONGODB_URI: 'not-a-url-s3cret', LOG_LEVEL: 'loud' });

    expect(parse).toThrow(EnvValidationError);
    expect(parse).toThrow(/MONGODB_URI/);
    expect(parse).toThrow(/LOG_LEVEL/);
    expect(parse).not.toThrow(/s3cret/);
  });
});
