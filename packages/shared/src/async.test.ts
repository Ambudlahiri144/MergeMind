import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeoutError, withTimeout } from './async.js';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the operation result when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000, 'fast')).resolves.toBe('ok');
  });

  it('rejects with TimeoutError when the operation is too slow', async () => {
    const slow = new Promise<string>(() => undefined);

    const result = withTimeout(slow, 1_000, 'mongo.ping');
    vi.advanceTimersByTime(1_000);

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    await expect(result).rejects.toThrow('mongo.ping timed out after 1000 ms');
  });

  it('passes through the operation error', async () => {
    const failing = Promise.reject(new Error('connection refused'));

    await expect(withTimeout(failing, 1_000, 'redis.ping')).rejects.toThrow('connection refused');
  });
});
