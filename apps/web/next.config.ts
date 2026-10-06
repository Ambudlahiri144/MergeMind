import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, '../..');

// One `.env` at the repo root serves every app (AGENTS.md §4); Next only reads its own folder.
// loadEnvFile never overrides variables that are already set.
const rootEnv = path.join(repoRoot, '.env');
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

// The E2E sign-in seam must never ship (ADR-029).
if (process.env.NODE_ENV === 'production' && process.env.MERGEMIND_E2E === '1') {
  throw new Error('MERGEMIND_E2E=1 is a test-only flag and cannot be used in production');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: repoRoot,
    // Turbopack has no custom export conditions, so the `@mergemind/source` condition
    // (ADR-015) is spelled as an alias: the web reads shared's TypeScript, never a stale dist.
    resolveAlias: {
      '@mergemind/shared': './packages/shared/src/index.ts',
    },
  },
};

export default nextConfig;
