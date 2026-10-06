import 'server-only';

import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';

import { webEnv } from './env';

const SESSION_SECONDS = 8 * 60 * 60;

/**
 * Better Auth, stateless (ADR-029): the session lives in an encrypted cookie and there is no
 * database adapter. Its only job is to prove which GitHub user is signed in; what they may see
 * is decided by the api. Endpoints that would let a user edit their own identity are off.
 */
export const auth = betterAuth({
  baseURL: webEnv().BETTER_AUTH_URL,
  ...(webEnv().BETTER_AUTH_SECRET === undefined ? {} : { secret: webEnv().BETTER_AUTH_SECRET }),
  socialProviders: {
    github: {
      clientId: webEnv().GITHUB_CLIENT_ID ?? '',
      clientSecret: webEnv().GITHUB_CLIENT_SECRET ?? '',
      // Typed as a string, but GitHub sends a number: normalise it.
      mapProfileToUser: (profile) => ({
        githubId: (profile.id as string | number).toString(),
        githubLogin: profile.login,
        // A GitHub App may not see the email; the noreply address keeps sign-in working.
        email: profile.email ?? `${profile.id}+${profile.login}@users.noreply.github.com`,
      }),
    },
  },
  user: {
    additionalFields: {
      githubId: { type: 'string', required: true },
      githubLogin: { type: 'string', required: true },
    },
  },
  session: {
    expiresIn: SESSION_SECONDS,
    cookieCache: { enabled: true, maxAge: SESSION_SECONDS, strategy: 'jwe' },
  },
  // `/update-user` would let a signed-in user rewrite githubLogin in their own session cookie.
  disabledPaths: ['/update-user', '/change-email', '/change-password', '/delete-user'],
  // Must be last: lets server actions set the auth cookies.
  plugins: [nextCookies()],
});
