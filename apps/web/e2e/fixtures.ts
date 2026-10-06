import { AxeBuilder } from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

import { E2E_AUTH_SECRET, E2E_USER } from './constants.js';

const E2E_SESSION_COOKIE = 'mm_e2e_session';

async function sessionToken(): Promise<string> {
  return new SignJWT({ githubId: E2E_USER.githubId, login: E2E_USER.login })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(E2E_AUTH_SECRET));
}

/** `signedIn`: a page whose browser holds the test session cookie (the E2E seam, ADR-029). */
export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page, context, baseURL }, use) => {
    await context.addCookies([
      {
        name: E2E_SESSION_COOKIE,
        value: await sessionToken(),
        url: baseURL ?? 'http://localhost:3100',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await use(page);
  },
});

/** Zero serious or critical axe violations (Design.md §8, Testing.md §4 E2E). */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(
    blocking.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

export { expect };
