import 'server-only';

import { jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth } from './auth';
import { isE2eMode, webEnv } from './env';

/** The signed-in GitHub user, as Better Auth proved it (ADR-029). */
export type Viewer = { githubId: number; login: string; name: string; image: string | null };

/** Test-only cookie for Playwright, honoured only with MERGEMIND_E2E=1 outside production. */
export const E2E_SESSION_COOKIE = 'mm_e2e_session';

const E2eClaimsSchema = z.object({
  githubId: z.number().int().positive(),
  login: z.string().min(1),
});

async function e2eViewer(): Promise<Viewer | null> {
  const env = webEnv();
  const token = (await cookies()).get(E2E_SESSION_COOKIE)?.value;
  if (!isE2eMode(env) || token === undefined || env.BETTER_AUTH_SECRET === undefined) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.BETTER_AUTH_SECRET), {
      algorithms: ['HS256'],
    });
    const claims = E2eClaimsSchema.parse(payload);
    return { githubId: claims.githubId, login: claims.login, name: claims.login, image: null };
  } catch {
    return null;
  }
}

/** Validates the session cookie (the proxy only checks that it exists). */
export async function getViewer(): Promise<Viewer | null> {
  if (isE2eMode()) {
    return e2eViewer();
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }
  const githubId = Number(session.user.githubId);
  if (!Number.isInteger(githubId) || githubId <= 0) {
    return null;
  }
  return {
    githubId,
    login: session.user.githubLogin,
    name: session.user.name || session.user.githubLogin,
    image: session.user.image ?? null,
  };
}

/** For pages behind sign-in: the viewer, or a redirect to /signin. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    redirect('/signin');
  }
  return viewer;
}
