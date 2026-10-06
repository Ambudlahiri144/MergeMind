import { API_JWT_AUDIENCE, API_JWT_ISSUER, UnauthorizedError } from '@mergemind/shared';
import { jwtVerify } from 'jose';
import { z } from 'zod';

/** Who is calling, as proven by the web's signed token (ADR-029). */
export type AuthUser = { githubUserId: number; login: string };

const ClaimsSchema = z.object({
  sub: z.string().regex(/^\d+$/),
  login: z.string().min(1).max(100),
});

export function apiTokenKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Verifies a web -> api bearer token: HS256 only, our issuer and audience, not expired. Every
 * failure is the same 401, so callers learn nothing about why a token was refused.
 */
export async function verifyApiToken(token: string, key: Uint8Array): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: API_JWT_ISSUER,
      audience: API_JWT_AUDIENCE,
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    const claims = ClaimsSchema.parse(payload);
    return { githubUserId: Number(claims.sub), login: claims.login };
  } catch (error) {
    throw new UnauthorizedError('A valid bearer token is required', { cause: error });
  }
}
