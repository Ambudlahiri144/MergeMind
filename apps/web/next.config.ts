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
  // No dev badge in E2E runs (it would show up in the landing-page screenshots).
  ...(process.env.MERGEMIND_E2E === '1' ? { devIndicators: false as const } : {}),
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
