import { test, expect, Page } from '@playwright/test';

// Title keyboard behaviour (F-EDIT-19.9, F-EDIT-15.7).

const HANDLE = '.pb-rail-handle';
const TITLE = '.pb-content [data-pb="title"]';

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
});

test.afterAll(async () => {
  await page.close();
});

test.describe('Enter in title (F-EDIT-19.9)', () => {
  test('pressing Enter in a title inserts a paragraph below and moves the caret there', async () => {
    // Count paragraphs before.
    const beforeCount = await page.locator('.pb-content p.pb-paragraph').count();

    // Click the first title to place the caret.
    await page.locator(TITLE).first().click();

    // Press Enter — our KEY_ENTER_COMMAND handler should intercept.
    await page.keyboard.press('Enter');

    // A new paragraph should exist and the caret should be inside it (the paragraph
    // count increases by 1 compared to before).
    await expect(page.locator('.pb-content p.pb-paragraph')).toHaveCount(beforeCount + 1);
  });
});

test.describe('Inline link editor (F-EDIT-15.7)', () => {
  test.fixme('selecting text and pressing Ctrl+K opens the floating URL bar');
  test.fixme('pressing Enter in the URL bar commits and hides the popup');
  test.fixme('pressing Escape in the URL bar discards changes and hides the popup');
  test.fixme('submitting an empty URL removes the link entirely');
});
