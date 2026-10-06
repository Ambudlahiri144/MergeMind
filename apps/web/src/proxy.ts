import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

const E2E_SESSION_COOKIE = 'mm_e2e_session';

/**
 * Fast redirect to /signin when there is no session cookie at all. This only checks that a
 * cookie exists; every page still validates the session itself (`requireViewer`).
 */
export function proxy(request: NextRequest) {
  const hasSession =
    getSessionCookie(request) !== null ||
    (process.env.MERGEMIND_E2E === '1' && request.cookies.has(E2E_SESSION_COOKIE));
  if (hasSession) {
    return NextResponse.next();
  }
  const signIn = new URL('/signin', request.url);
  signIn.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ['/repos/:path*', '/runs/:path*', '/settings/:path*'],
};
