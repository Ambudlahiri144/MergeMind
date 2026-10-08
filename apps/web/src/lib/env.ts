import 'server-only';

import { MIN_API_JWT_SECRET_LENGTH } from '@mergemind/shared';
import { z } from 'zod';

// Server-side configuration of the web app, validated once (rules.md §3). Never imported by a
// client component: `server-only` makes that a build error.

const WebEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_BASE_URL: z.url().default('http://localhost:4000'),
  API_JWT_SECRET: z.string().min(MIN_API_JWT_SECRET_LENGTH).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  /** The App's public slug, for "Install on GitHub" links. */
  GITHUB_APP_SLUG: z.string().min(1).default('mergemind-review'),
  /** Mirrors the worker's INDEX_ENABLED (ADR-038): `false` hides Reindex, which would do nothing. */
  INDEX_ENABLED: z.enum(['true', 'false']).default('true'),
  /** E2E sign-in seam (ADR-029); honoured only outside production. */
  MERGEMIND_E2E: z.enum(['0', '1']).default('0'),
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

let cached: WebEnv | undefined;

export function webEnv(): WebEnv {
  cached ??= WebEnvSchema.parse(process.env);
  return cached;
}

export function isE2eMode(env: WebEnv = webEnv()): boolean {
  return env.MERGEMIND_E2E === '1' && env.NODE_ENV !== 'production';
}

export function isIndexEnabled(env: WebEnv = webEnv()): boolean {
  return env.INDEX_ENABLED === 'true';
}

export function installUrl(env: WebEnv = webEnv()): string {
  return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
}
