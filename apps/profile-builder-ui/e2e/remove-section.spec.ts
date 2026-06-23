import { test, expect, Page } from '@playwright/test';

// Title deletion via keyboard (US-EDIT-19). A title node is removed like a
// paragraph — select it and press Backspace/Delete — no dedicated remove button.
// The gutter rail shows only drag handle + move-up/down controls.

const HANDLE = '.pb-rail-handle';
const TITLE = '.pb-content [data-pb="title"]';

let page: Page;
let seed: string;

async function titleTexts(): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.pb-content [data-pb="title"]')).map(
      (el) => el.textContent ?? '',
    ),
  );
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
  seed = await page.evaluate(
    () =>
      JSON.stringify(
        (document.querySelector('applysy-profile-builder') as unknown as { document: unknown })
          .document,
      ),
  );
});

test.afterAll(async () => {
  await page.close();
});

test.beforeEach(async () => {
  await page.evaluate((s) => {
    (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document =
      JSON.parse(s);
  }, seed);
  await expect(page.locator(TITLE).first()).toBeVisible();
});

test.describe('Title deletion (US-EDIT-19)', () => {
  test('no dedicated remove button exists on a title — gutter has only drag handle', async () => {
    expect(await page.locator('[aria-label="Remove title"]').count()).toBe(0);
    expect(await page.locator('[aria-label="Remove section"]').count()).toBe(0);
    expect(await page.locator('[aria-label="Move section up"]').count()).toBe(0);
    expect(await page.locator('[aria-label="Move section down"]').count()).toBe(0);
    expect(await page.locator(HANDLE).count()).toBeGreaterThan(0);
  });

  test('selecting a title and pressing Backspace removes it', async () => {
    const before = await titleTexts();
    // Triple-click selects the whole title line, then Backspace deletes it.
    await page.locator(TITLE).first().click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    const after = await titleTexts();
    expect(after.length).toBe(before.length - 1);
  });
});
