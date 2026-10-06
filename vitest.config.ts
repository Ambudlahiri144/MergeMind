import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Resolve @mergemind/* packages to their TypeScript sources (see each package's "exports").
// No 'module' condition: some deps (e.g. @opentelemetry/api) map it to bundler-only ESM builds
// with extensionless imports that Node cannot load.
const SOURCE_CONDITIONS = ['@mergemind/source', 'node', 'development|production'];

const INT_TEST_TIMEOUT_MS = 60_000;
const INT_HOOK_TIMEOUT_MS = 180_000;

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    conditions: SOURCE_CONDITIONS,
    alias: [
      // apps/web: its `@/` path alias, and `server-only` (throws outside React Server).
      { find: /^@\/(.*)$/, replacement: `${fromRoot('./apps/web/src/')}$1` },
      { find: 'server-only', replacement: fromRoot('./test/setup/server-only-stub.ts') },
    ],
  },
  ssr: { resolve: { conditions: SOURCE_CONDITIONS } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            '{apps,packages}/*/src/**/*.test.{ts,tsx}',
            'packages/*/test/contract/**/*.test.ts',
            'evals/src/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'int',
          environment: 'node',
          include: ['{apps,packages}/*/test/integration/**/*.int.test.ts'],
          globalSetup: ['./test/setup/containers.ts'],
          testTimeout: INT_TEST_TIMEOUT_MS,
          hookTimeout: INT_HOOK_TIMEOUT_MS,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['{apps,packages}/*/src/**/*.{ts,tsx}', 'evals/src/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/index.ts', 'apps/web/**'],
    },
  },
});
