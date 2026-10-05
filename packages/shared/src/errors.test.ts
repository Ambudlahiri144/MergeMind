import { describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
  isAppError,
} from './errors.js';

describe('AppError subclasses', () => {
  it.each([
    [new ValidationError('bad'), 400, 'validation'],
    [new UnauthorizedError('no token'), 401, 'unauthorized'],
    [new ForbiddenError('not yours'), 403, 'forbidden'],
    [new NotFoundError('missing'), 404, 'not-found'],
    [new ConflictError('exists'), 409, 'conflict'],
    [new RateLimitedError('slow down', 30), 429, 'rate-limited'],
    [new BudgetExceededError('budget used'), 429, 'budget-exceeded'],
    [new UpstreamError('github down', 'github'), 502, 'upstream'],
  ])('maps %s to status %i and type %s', (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.type).toBe(`https://mergemind.dev/errors/${code}`);
  });

  it('builds an RFC 9457 problem body with instance and requestId', () => {
    const error = new NotFoundError('Repository 66f not found');

    const problem = error.toProblem({ instance: '/api/v1/repositories/66f', requestId: 'req_1' });

    expect(problem).toEqual({
      type: 'https://mergemind.dev/errors/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Repository 66f not found',
      instance: '/api/v1/repositories/66f',
      requestId: 'req_1',
    });
  });

  it('includes validation issues in the problem body', () => {
    const error = new ValidationError('Invalid body', [{ path: 'isEnabled', message: 'Required' }]);

    expect(error.toProblem().errors).toEqual([{ path: 'isEnabled', message: 'Required' }]);
  });

  it('keeps the cause for debugging', () => {
    const cause = new Error('socket hang up');

    const error = new UpstreamError('GitHub request failed', 'github', { cause });

    expect(error.cause).toBe(cause);
    expect(error.name).toBe('UpstreamError');
  });

  it('recognizes app errors and rejects plain errors', () => {
    expect(isAppError(new ConflictError('dup'))).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
