import { describe, expect, it } from 'vitest';

import { installUrl, isE2eMode, isIndexEnabled, type WebEnv } from './env';

const BASE: WebEnv = {
  NODE_ENV: 'development',
  API_BASE_URL: 'http://localhost:4000',
  BETTER_AUTH_URL: 'http://localhost:3000',
  GITHUB_APP_SLUG: 'mergemind-review',
  INDEX_ENABLED: 'true',
  MERGEMIND_E2E: '0',
};

describe('the E2E sign-in seam (ADR-029)', () => {
  it('is off unless MERGEMIND_E2E=1, and never in production', () => {
    expect(isE2eMode(BASE)).toBe(false);
    expect(isE2eMode({ ...BASE, MERGEMIND_E2E: '1' })).toBe(true);
    expect(isE2eMode({ ...BASE, MERGEMIND_E2E: '1', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('installUrl', () => {
  it('points at the App installation page', () => {
    expect(installUrl(BASE)).toBe('https://github.com/apps/mergemind-review/installations/new');
  });
});

describe('isIndexEnabled (ADR-038)', () => {
  it('is on by default and off when the host has no code index', () => {
    expect(isIndexEnabled(BASE)).toBe(true);
    expect(isIndexEnabled({ ...BASE, INDEX_ENABLED: 'false' })).toBe(false);
  });
});
