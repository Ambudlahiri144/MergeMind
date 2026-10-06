import { API_JWT_AUDIENCE, API_JWT_ISSUER } from '@mergemind/shared';
import { SignJWT } from 'jose';

export const TEST_API_JWT_SECRET = 'test-api-jwt-secret-that-is-long-enough-123';

/** Mints a web -> api token like the web does (ADR-029); options let tests break it. */
export function signTestToken(
  user: { githubUserId: number; login: string },
  options: { secret?: string; issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({ login: user.login })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.githubUserId))
    .setIssuer(options.issuer ?? API_JWT_ISSUER)
    .setAudience(options.audience ?? API_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(new TextEncoder().encode(options.secret ?? TEST_API_JWT_SECRET));
}
