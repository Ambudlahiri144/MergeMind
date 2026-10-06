import { UnauthorizedError } from '@mergemind/shared';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { TEST_API_JWT_SECRET, signTestToken } from '../../test/support/api-token.js';
import { apiTokenKey, verifyApiToken } from './api-token.js';

const key = apiTokenKey(TEST_API_JWT_SECRET);
const user = { githubUserId: 9001, login: 'ananya-iyer' };

describe('verifyApiToken (ADR-029)', () => {
  it('accepts a web-minted token and returns the user', async () => {
    expect(await verifyApiToken(await signTestToken(user), key)).toEqual(user);
  });

  it.each([
    ['another secret', { secret: 'a-completely-different-secret-value-xyz' }],
    ['the wrong issuer', { issuer: 'someone-else' }],
    ['the wrong audience', { audience: 'another-api' }],
    ['an expired token', { expiresIn: '-1m' }],
  ])('rejects %s with a 401', async (_label, options) => {
    const token = await signTestToken(user, options);

    await expect(verifyApiToken(token, key)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token without a numeric GitHub user id', async () => {
    const token = await new SignJWT({ login: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-a-number')
      .setIssuer('mergemind-web')
      .setAudience('mergemind-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);

    await expect(verifyApiToken(token, key)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects garbage', async () => {
    await expect(verifyApiToken('not.a.jwt', key)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
