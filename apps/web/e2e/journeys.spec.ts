import type { Page } from '@playwright/test';

import {
  E2E_CRITICAL_TITLE,
  E2E_EMPTY_REPO,
  E2E_MINOR_TITLE,
  E2E_PR_NUMBER,
  E2E_REPO,
} from './constants.js';
import { expect, expectAccessible, test } from './fixtures.js';

// Testing.md §4 E2E journeys, against the real api and a seeded database.

/** Repositories -> repository -> PR -> its run, waiting for each page before moving on. */
async function openSeededRun(page: Page, options: { checkA11y?: boolean } = {}) {
  await page.goto('/repos');
  await expect(page.getByRole('heading', { name: 'Repositories', level: 1 })).toBeVisible();
  if (options.checkA11y) {
    await expectAccessible(page);
  }

  await page.getByRole('link', { name: E2E_REPO }).click();
  await expect(page.getByRole('heading', { name: E2E_REPO, level: 1 })).toBeVisible();
  if (options.checkA11y) {
    // The policy comes from the fake GitHub: the repo's own .mergemind.yml on main.
    await expect(page.getByText('.mergemind.yml on main')).toBeVisible();
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();
    await expectAccessible(page);
  }

  await page.getByRole('link', { name: /Fix refund rounding/ }).click();
  await expect(
    page.getByRole('heading', { name: `#${String(E2E_PR_NUMBER)} Fix refund rounding` }),
  ).toBeVisible();
  await expect(page.getByText('Merge blocked: 1 critical finding')).toBeVisible();
  if (options.checkA11y) {
    await expectAccessible(page);
  }

  // The run row (not the PR row on the previous page, which also shows the SHA).
  await page.getByRole('link', { name: /Opened · Full review/ }).click();
  await expect(page.getByRole('heading', { name: /^Review of c3d4e5f/, level: 1 })).toBeVisible();
}

/** Repeats an interaction until it takes effect: client components ignore clicks before hydration. */
async function untilHydrated(interaction: () => Promise<void>) {
  await expect(interaction).toPass({ timeout: 30_000 });
}

test('an anonymous visitor is sent to sign-in', async ({ page }) => {
  await page.goto('/repos');

  await expect(page).toHaveURL(/\/signin\?next=%2Frepos/);
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expectAccessible(page);
});

test('repositories, then PR, then run detail with findings', async ({ signedIn: page }) => {
  await openSeededRun(page, { checkA11y: true });

  await expect(page.getByRole('heading', { name: E2E_CRITICAL_TITLE })).toBeVisible();
  await expect(page.getByRole('heading', { name: E2E_MINOR_TITLE })).toBeVisible();
  // The diff panel shows the flagged line from the file at the run's head.
  await expect(page.getByRole('complementary', { name: 'Code' })).toContainText(
    "const PAYMENT_KEY = 'pay_secret_prod_",
  );
  await expectAccessible(page);
});

test('dismissing a finding removes it from the open findings', async ({ signedIn: page }) => {
  await openSeededRun(page);
  const card = page.getByRole('article').filter({ hasText: E2E_MINOR_TITLE });
  const dialog = page.getByRole('dialog', { name: 'Dismiss this finding?' });

  await untilHydrated(async () => {
    await card.getByRole('button', { name: 'Dismiss' }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  });
  await expectAccessible(page);
  await dialog.getByLabel('Reason').fill('Intended name, documented in the ADR');
  await dialog.getByRole('button', { name: 'Dismiss' }).click();

  await expect(card.getByText('· dismissed')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
});

test('an empty repository shows its empty state', async ({ signedIn: page }) => {
  await page.goto('/repos');
  await page.getByRole('link', { name: E2E_EMPTY_REPO }).click();

  await expect(
    page.getByText('No pull requests reviewed yet. Open a PR on this repository.'),
  ).toBeVisible();
  await expectAccessible(page);
});

test('settings shows the usage line and budget form', async ({ signedIn: page }) => {
  await page.goto('/settings');

  await expect(page.getByText(/1\.24M of 2M tokens used this month \(62%\)/)).toBeVisible();
  await expect(page.getByLabel('Tokens per month')).toHaveValue('2000000');
  await expectAccessible(page);
});

test('dark theme is accessible and persists across a reload', async ({ signedIn: page }) => {
  await page.goto('/repos');
  const html = page.locator('html');

  await untilHydrated(async () => {
    await page.getByRole('button', { name: /^Theme: system/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'light', { timeout: 1_000 });
  });
  await page.getByRole('button', { name: /^Theme: light/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // The cookie is written by a server action; wait until a fresh request sees it.
  await expect(async () => {
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  await expectAccessible(page);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no screen scrolls horizontally', async ({ signedIn: page }) => {
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

    for (const path of ['/repos', '/settings']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await overflow(), path).toBeLessThanOrEqual(0);
    }
    await openSeededRun(page);
    expect(await overflow(), 'run page').toBeLessThanOrEqual(0);
  });
});

test('the landing page is accessible and fits a phone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Code review that never sleeps.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Install on GitHub' })).toHaveCount(3);
  await expectAccessible(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAccessible(page);
});
