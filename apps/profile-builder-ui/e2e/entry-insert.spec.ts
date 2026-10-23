import { test, expect, Page } from '@playwright/test';

// Insert elements inside timeline entries (US-EDIT-20 / spec §14).
//
// When the caret sits in a timeline entry's description, the insert rail must
// drop a List / Link / Chips INSIDE that entry's content — not at root level,
// which is where the old `rootLevelAnchor()` always put them. Assertions read
// the web component's serialized `document` (the source of truth) and check the
// new node's parent, which avoids DOM render-timing races.

const HANDLE = '.pb-rail-handle';

let page: Page;
let seed: string;

/** Child `type`s of the first timeline entry, in document order. */
async function firstEntryChildTypes(): Promise<string[]> {
  return page.evaluate(() => {
    const find = (node: { type?: string; children?: unknown[] }): any => {
      for (const child of (node.children ?? []) as { type?: string; children?: unknown[] }[]) {
        if (child.type === 'entry') return child;
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: unknown[] } };
    };
    const entry = find(el.document.body);
    return ((entry?.children ?? []) as { type: string }[]).map((c) => c.type);
  });
}

/** Every node `type` reachable under the first timeline entry (deep). */
async function firstEntryDeepTypes(): Promise<string[]> {
  return page.evaluate(() => {
    const find = (node: { type?: string; children?: unknown[] }): any => {
      for (const child of (node.children ?? []) as { type?: string; children?: unknown[] }[]) {
        if (child.type === 'entry') return child;
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    const walk = (node: { type?: string; children?: unknown[] }, out: string[]) => {
      for (const child of (node.children ?? []) as { type: string; children?: unknown[] }[]) {
        out.push(child.type);
        walk(child, out);
      }
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: unknown[] } };
    };
    const entry = find(el.document.body);
    const out: string[] = [];
    if (entry) walk(entry, out);
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

/** Place a collapsed caret inside the first entry's description paragraph, and
 * sync Lexical's selection so a following rail click / keypress sees it. */
async function caretInFirstEntryDescription() {
  await page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const entry = el.querySelector('[data-pb="entry"]') as Element;
    // A description text span is any lexical text NOT inside a title/dates field.
    const span = Array.from(entry.querySelectorAll('span[data-lexical-text]')).find(
      (s) => !s.closest('[data-pb="entry-title"]') && !s.closest('[data-pb="entry-dates"]'),
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

test.describe('Insert elements inside timeline entries (US-EDIT-20)', () => {
  test('inserting Chips with the caret in an entry adds chips inside that entry, not at root', async () => {
    const rootBefore = await rootChildTypes();

    await caretInFirstEntryDescription();
    await page.locator('button[aria-label^="Chips"]').click();

    expect(await firstEntryChildTypes()).toContain('chips');
    // Root child count unchanged — nothing was appended at root level.
    expect(await rootChildTypes()).toEqual(rootBefore);
  });

  test('inserting a List with the caret in an entry adds a list inside that entry', async () => {
    await caretInFirstEntryDescription();
    await page.locator('button[aria-label^="List"]').click();

    expect(await firstEntryChildTypes()).toContain('list');
  });

  test('inserting a Link with the caret in an entry adds an inline link inside that entry (US-EDIT-21)', async () => {
    const rootBefore = await rootChildTypes();

    await caretInFirstEntryDescription();
    await page.locator('button[aria-label^="Link"]').click();
    // The link editor inserts nothing until its URL is confirmed.
    const urlField = page.getByRole('dialog', { name: /link/i }).getByLabel('Link URL');
    await urlField.fill('https://case.dev');
    await urlField.press('Enter');

    // Links are now inline runs inside the entry's description paragraph, not a
    // standalone link line — but still inside the entry, never at root.
    expect(await firstEntryDeepTypes()).toContain('inlineLink');
    expect(await rootChildTypes()).toEqual(rootBefore);
  });

  test('the rail hides Timeline and Title when the caret is inside an entry', async () => {
    // At root the full rail (incl. Timeline + Title) is offered…
    await expect(page.locator('button[aria-label^="Timeline"]')).toBeVisible();
    await expect(page.locator('button[aria-label^="Title"]')).toBeVisible();

    // …but inside an entry the rail is scoped to entry-valid widgets only.
    await caretInFirstEntryDescription();
    await expect(page.locator('button[aria-label^="Timeline"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label^="Title"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label^="Chips"]')).toBeVisible();
  });
});
