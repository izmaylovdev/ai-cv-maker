import { test, expect, Page } from '@playwright/test';

// Timeline entry structure guard (US-EDIT-17 / F-EDIT-17.5).
//
// A timeline entry's subsections — title, dates, description — are required and
// must not be removable by editing: Backspace at the start of one (or Delete at
// the end) would otherwise merge it into its neighbour or delete the line,
// leaving a malformed entry. The user may clear a field's text but never remove
// the field itself.
//
// Caret placement is done deterministically (the title/dates share a grid row,
// so Home/End are ambiguous): we set the editor selection to the field's start
// and sync Lexical via `selectionchange`, then press a REAL key so the guard's
// command handler runs against the real selection. Assertions read the web
// component's serialized `document` (the source of truth), which avoids DOM
// render-timing races. The page is loaded once and reset between tests.

const HANDLE = '.pb-rail-handle';

interface EntryModel {
  attrs: { title: string; dates: string };
  children: { type: string }[];
}

let page: Page;
let seed: string;

/** All entries in the serialized document, in order. */
async function entries(): Promise<EntryModel[]> {
  return page.evaluate(() => {
    const collect = (node: { type?: string; children?: unknown[] }, acc: unknown[]) => {
      for (const child of (node.children ?? []) as { type?: string; children?: unknown[] }[]) {
        if (child.type === 'entry') acc.push(child);
        collect(child, acc);
      }
      return acc;
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: unknown[] } };
    };
    return collect(el.document.body, []) as EntryModel[];
  });
}

/** Place a collapsed caret at `offset` inside the given field of entry `index`,
 * and sync Lexical's selection so a following real keypress sees it. */
async function caretInField(index: number, field: 'entry-title' | 'entry-dates', offset: number) {
  await page.evaluate(
    ({ index, field, offset }) => {
      const el = document.querySelector('applysy-profile-builder') as Element;
      const entry = el.querySelectorAll('[data-pb="entry"]')[index];
      const span = entry.querySelector(`[data-pb="${field}"] span[data-lexical-text]`) as Node;
      const target = span.firstChild ?? span;
      const range = document.createRange();
      range.setStart(target, offset);
      range.collapse(true);
      const sel = window.getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(range);
      (el.querySelector('.pb-content') as HTMLElement).focus();
      document.dispatchEvent(new Event('selectionchange'));
    },
    { index, field, offset },
  );
  await page.waitForTimeout(60);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
  seed = await page.evaluate(() =>
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
  await expect(page.locator('[data-pb="entry"]').first()).toBeVisible();
});

test.describe('Timeline entry structure guard (US-EDIT-17)', () => {
  test('Backspace at the start of the dates field neither removes nor merges it', async () => {
    const before = await entries();
    expect(before.length).toBeGreaterThan(0);
    const { title, dates } = before[0].attrs;

    await caretInField(0, 'entry-dates', 0);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    const after = await entries();
    expect(after.length).toBe(before.length);
    // Both fields survive with their text intact (no merge into the title).
    expect(after[0].attrs.title).toBe(title);
    expect(after[0].attrs.dates).toBe(dates);
  });

  test('Backspace at the start of the title field does not remove the entry', async () => {
    const before = await entries();
    const { title, dates } = before[0].attrs;

    await caretInField(0, 'entry-title', 0);
    await page.keyboard.press('Backspace');

    const after = await entries();
    expect(after.length).toBe(before.length);
    expect(after[0].attrs.title).toBe(title);
    expect(after[0].attrs.dates).toBe(dates);
  });

  test('ordinary mid-field Backspace still edits the text (not over-blocked)', async () => {
    const before = await entries();
    const title = before[0].attrs.title;
    expect(title.length).toBeGreaterThan(2);

    // Caret after the 2nd character — a normal Backspace must delete the 2nd.
    await caretInField(0, 'entry-title', 2);
    await page.keyboard.press('Backspace');

    const after = await entries();
    expect(after.length).toBe(before.length);
    expect(after[0].attrs.title).toBe(title.slice(0, 1) + title.slice(2));
  });
});
