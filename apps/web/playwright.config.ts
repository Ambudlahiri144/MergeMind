import { defineConfig, devices } from '@playwright/test';

import { E2E_BASE_URL } from './e2e/constants.js';

const STACK_STARTUP_MS = 300_000;

// E2E journeys (Testing.md §1). `e2e/stack.ts` starts the containers, the real api and
// `next dev` with the test sign-in seam; Playwright waits for the sign-in page.
export default defineConfig({
  testDir: './e2e',
  // Screenshot capture has its own config (playwright.screens.config.ts).
  testIgnore: ['**/screens/**'],
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx tsx --conditions=@mergemind/source e2e/stack.ts',
    url: `${E2E_BASE_URL}/signin`,
    timeout: STACK_STARTUP_MS,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
