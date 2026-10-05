import { EnvValidationError } from '@mergemind/shared';
import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';

const REQUIRED = {
  MONGODB_URI: 'mongodb://localhost:27017/mergemind?directConnection=true',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadWorkerEnv', () => {
  it('applies the queue concurrency defaults from Architecture.md', () => {
    const env = loadWorkerEnv(REQUIRED);

    expect(env).toMatchObject({
      REVIEW_CONCURRENCY: 4,
      INDEX_CONCURRENCY: 1,
      CI_SUMMARY_CONCURRENCY: 2,
    });
  });

  it('rejects a non-redis REDIS_URL', () => {
    expect(() => loadWorkerEnv({ ...REQUIRED, REDIS_URL: 'http://localhost:6379' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects a missing MONGODB_URI', () => {
    expect(() => loadWorkerEnv({ REDIS_URL: REQUIRED.REDIS_URL })).toThrow(/MONGODB_URI/);
  });

  it('rejects zero concurrency', () => {
    expect(() => loadWorkerEnv({ ...REQUIRED, REVIEW_CONCURRENCY: '0' })).toThrow(
      /REVIEW_CONCURRENCY/,
    );
  });
});
