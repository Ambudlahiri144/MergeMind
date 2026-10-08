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
  // E2E runs its own `next dev` next to yours; Next allows one dev server per build directory.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  // E2E runs: no dev badge (it would show up in the landing-page screenshots), and no persistent
  // Turbopack dev cache. A warm `.next-e2e` cache produced one-off "module not found" and route
  // 404s locally; starting cold every time also matches CI.
  ...(process.env.MERGEMIND_E2E === '1'
    ? {
        devIndicators: false as const,
        experimental: { turbopackFileSystemCacheForDev: false },
      }
    : {}),
  // Turbopack has no custom export conditions and cannot map shared's `.js` specifiers to
  // `.ts`, so the web reads `@mergemind/shared` from its dist. The web's predev, prebuild,
  // pretest:e2e and prescreenshots scripts rebuild it first (ADR-035).
  turbopack: {
    root: repoRoot,
  },
  // Monorepo: trace server files from the repo root so Vercel's deployment includes
  // packages/shared/dist (Deploy.md). Must match turbopack.root.
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
