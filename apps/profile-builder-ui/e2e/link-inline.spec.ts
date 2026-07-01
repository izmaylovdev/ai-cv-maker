import { test, expect, Page } from '@playwright/test';

// Inline links in running text (US-EDIT-21 / spec §15).
//
// Clicking Link with a collapsed caret inserts an inline link AT the caret (not a
// new line); the floating URL editor must reliably save the typed URL, and a
// caret-inserted link's label mirrors its URL. With a selection, the selected
// text becomes the label. Assertions read the component's serialized `document`.

const HANDLE = '.pb-rail-handle';

let page: Page;
let seed: string;

/** All `inlineLink` runs anywhere in the body, as { text, url }. */
async function inlineLinks(): Promise<{ text: string; url: string }[]> {
  return page.evaluate(() => {
    const out: { text: string; url: string }[] = [];
    const walk = (node: { type?: string; attrs?: Record<string, string>; children?: unknown[] }) => {
      if (node.type === 'inlineLink') out.push({ text: node.attrs?.['text'] ?? '', url: node.attrs?.['url'] ?? '' });
      for (const child of (node.children ?? []) as typeof node[]) walk(child);
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: unknown[] } };
    };
    walk(el.document.body as never);
    return out;
  });
}

/** Root-level child `type`s, in document order. */
async function rootChildTypes(): Promise<string[]> {
  return page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: { type: string }[] } };
    };
    return (el.document.body.children ?? []).map((c) => c.type);
  });
}

/** The first running-text span at root (not a title/heading or entry field). */
function rootParagraphSpan() {
  return page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const span = Array.from(el.querySelectorAll('span[data-lexical-text]')).find(
      (s) =>
        !s.closest('[data-pb="title"]') &&
        !s.closest('[data-pb="entry-title"]') &&
        !s.closest('[data-pb="entry-dates"]') &&
        !s.closest('[data-pb="entry"]'),
    );
    return Boolean(span);
  });
}

/** Place a collapsed caret at the start of the first root paragraph span. */
async function caretInRootParagraph() {
  await page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const span = Array.from(el.querySelectorAll('span[data-lexical-text]')).find(
      (s) =>
        !s.closest('[data-pb="title"]') &&
        !s.closest('[data-pb="entry-title"]') &&
        !s.closest('[data-pb="entry-dates"]') &&
        !s.closest('[data-pb="entry"]'),
    ) as Node;
    const target = span.firstChild ?? span;
    const range = document.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    (el.querySelector('.pb-content') as HTMLElement).focus();
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(60);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
  expect(await rootParagraphSpan()).toBe(true);
  seed = await page.evaluate(() =>
    JSON.stringify(
      (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document,
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
  await expect(page.locator('.pb-content')).toBeVisible();
});

test.describe('Inline links in running text (US-EDIT-21)', () => {
  test('clicking Link at a collapsed caret inserts an inline link, not a new block line', async () => {
    const rootBefore = await rootChildTypes();

    await caretInRootParagraph();
    await page.locator('button[aria-label^="Link"]').click();

    // No new root-level node — the link is inline within the existing paragraph.
    expect(await rootChildTypes()).toEqual(rootBefore);
    expect((await inlineLinks()).length).toBe(1);
  });

  test('the floating URL editor saves the typed URL and mirrors it as the label', async () => {
    await caretInRootParagraph();
    await page.locator('button[aria-label^="Link"]').click();

    const input = page.locator('.pb-inline-link-editor__input');
    await expect(input).toBeVisible();
    await input.fill('https://example.com');
    await page.locator('.pb-inline-link-editor__btn--apply').click();

    await expect.poll(async () => await inlineLinks()).toEqual([
      { text: 'https://example.com', url: 'https://example.com' },
    ]);
  });

  test('committing an empty URL removes the caret-inserted link', async () => {
    await caretInRootParagraph();
    await page.locator('button[aria-label^="Link"]').click();
    await expect(page.locator('.pb-inline-link-editor__input')).toBeVisible();

    // Apply with an empty URL → the placeholder link is removed entirely.
    await page.locator('.pb-inline-link-editor__btn--apply').click();

    await expect.poll(async () => (await inlineLinks()).length).toBe(0);
  });
});
