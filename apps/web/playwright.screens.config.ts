import { defineConfig, devices } from '@playwright/test';

import baseConfig from './playwright.config.js';

// Captures the landing-page screenshots on the E2E stack; never part of `npm run test:e2e`.
export default defineConfig({
  ...baseConfig,
  testDir: './e2e/screens',
  testIgnore: [],
  reporter: 'list',
  retries: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 } }],
});
