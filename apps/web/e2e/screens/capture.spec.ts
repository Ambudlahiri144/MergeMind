import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '../fixtures.js';

// Real screenshots for the landing page (Design.md §5, Taste-skill §4.8): the app on the
// seeded E2E stack (sample data, labelled as such on the page) and MergeMind's review on a
// public GitHub PR. Run with `npm run screenshots -w @mergemind/web`.

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/screens');
const PUBLIC_PR = 'https://github.com/Ambudlahiri144/dev_portfolio/pull/2';

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const theme of ['light', 'dark'] as const) {
  test(`app screens, ${theme}`, async ({ signedIn: page, context, baseURL }) => {
    await context.addCookies([{ name: 'mm-theme', value: theme, url: baseURL ?? '' }]);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/repos');
    await page.getByRole('link', { name: 'ananya-iyer/payments' }).click();
    await page.getByRole('link', { name: /Fix refund rounding/ }).click();
    await page.getByRole('link', { name: /Opened · Full review/ }).click();
    const code = page.getByRole('complementary', { name: 'Code' });
    await expect(code).toContainText('PAYMENT_KEY');

    await page
      .getByRole('article')
      .first()
      .screenshot({ path: path.join(OUT, `finding-${theme}.png`) });

    // Hero crop: a narrower viewport (the run page keeps its two columns at 1024+) cut to the
    // gate, the first finding and the code panel, so the hero stays readable at ~650px wide.
    await page.setViewportSize({ width: 1040, height: 900 });
    const gate = page.getByText('Merge blocked: 1 critical finding');
    const firstFinding = page.getByRole('article').first();
    const main = page.locator('main');
    const [gateBox, findingBox, mainBox, codeBox] = await Promise.all([
      gate.boundingBox(),
      firstFinding.boundingBox(),
      main.boundingBox(),
      code.boundingBox(),
    ]);
    if (!gateBox || !findingBox || !mainBox || !codeBox) {
      throw new Error('run page not laid out');
    }
    const left = mainBox.x + 16;
    const right = mainBox.x + mainBox.width - 16;
    const top = gateBox.y - 24;
    const bottom = Math.max(findingBox.y + findingBox.height, codeBox.y + codeBox.height) + 16;
    await page.screenshot({
      path: path.join(OUT, `hero-${theme}.png`),
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    });
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`MergeMind review on GitHub, ${colorScheme}`, async ({ browser }) => {
    const context = await browser.newContext({
      colorScheme,
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(PUBLIC_PR, { waitUntil: 'domcontentloaded' });
    const review = page
      .locator('[id^="pullrequestreview-"]')
      .filter({ hasText: 'MergeMind review' })
      .first();
    await expect(review).toBeVisible({ timeout: 30_000 });
    await review.scrollIntoViewIfNeeded();
    // GitHub's sticky PR header would slide over the review: hide anything pinned to the
    // viewport, after scrolling (the header only becomes sticky once the page scrolls).
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>('body *')) {
        const { position } = getComputedStyle(element);
        if (position === 'sticky' || position === 'fixed') {
          element.style.setProperty('display', 'none', 'important');
        }
      }
    });
    const box = await review.boundingBox();
    if (!box) {
      throw new Error('review not laid out');
    }
    // The review summary and its first inline comment: enough to read, short enough to show.
    await page.screenshot({
      path: path.join(OUT, `github-review-${colorScheme}.png`),
      fullPage: true,
      clip: {
        x: box.x,
        y: box.y + (await page.evaluate(() => window.scrollY)),
        width: box.width,
        height: Math.min(box.height, 690),
      },
    });
    await context.close();
  });
}
