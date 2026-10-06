import { API_JWT_AUDIENCE, API_JWT_ISSUER, API_JWT_TTL_SECONDS } from '@mergemind/shared';
import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { mintApiToken } from './api';

const SECRET = 'web-test-secret-that-is-at-least-32-chars';

describe('mintApiToken (ADR-029)', () => {
  it('carries only identity, for the api audience, valid five minutes', async () => {
    const now = new Date('2026-10-06T12:00:00Z');

    const token = await mintApiToken(
      { githubId: 9001, login: 'ananya-iyer', name: 'Ananya Iyer', image: null },
      SECRET,
      now,
    );
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(SECRET), {
      issuer: API_JWT_ISSUER,
      audience: API_JWT_AUDIENCE,
      currentDate: now,
    });

    expect(protectedHeader.alg).toBe('HS256');
    expect(payload).toMatchObject({ sub: '9001', login: 'ananya-iyer' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(API_JWT_TTL_SECONDS);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'login', 'sub']);
  });
});
