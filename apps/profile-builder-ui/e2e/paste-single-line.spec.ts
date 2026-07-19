import { test, expect, Page } from '@playwright/test';

// Single-line fields stay single-line on paste.
//
// Lexical's default rich-text paste converts clipboard HTML into block nodes and
// hands them to RangeSelection.insertNodes, which merges only the FIRST block
// into the caret's block and calls insertRangeAfter() for the rest. In an entry
// title that dropped the overflow paragraph in as a SIBLING of the field —
// between the title and dates rows — so the pasted text rendered after the field
// instead of inside it, and the entry's title → dates → description contract was
// broken.
//
// Same caret technique as timeline-entry.spec.ts: set the DOM range, sync
// Lexical via `selectionchange`, then dispatch a real paste event. Assertions
// read the web component's serialized `document`, the source of truth.

const HANDLE = '.pb-rail-handle';

interface EntryModel {
  attrs: { title: string; dates: string };
  children: { type: string }[];
}

interface TitleModel {
  type: string;
  attrs: { text: string };
}

let page: Page;
let seed: string;

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

/** Top-level children of the body, for checking nothing spilled to the root. */
async function rootChildren(): Promise<TitleModel[]> {
  return page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: unknown[] } };
    };
    return (el.document.body.children ?? []) as TitleModel[];
  });
}

/**
 * Put a collapsed caret at the start of `selector` (scoped to entry `index` when
 * given) and dispatch a rich-text paste carrying two HTML blocks.
 */
async function pasteBlocksAt(
  target: { entryIndex: number; field: 'entry-title' | 'entry-dates' } | { titleIndex: number },
  html: string,
  text: string,
) {
  await page.evaluate(
    ({ target, html, text }) => {
      const el = document.querySelector('applysy-profile-builder') as Element;
      const host =
        'titleIndex' in target
          ? (el.querySelectorAll('[data-pb="title"]')[target.titleIndex] as Element)
          : (el
              .querySelectorAll('[data-pb="entry"]')
              [target.entryIndex].querySelector(`[data-pb="${target.field}"]`) as Element);
      const span = host.querySelector('span[data-lexical-text]') ?? host;
      const node = span.firstChild ?? span;

      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      const sel = window.getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(range);
      (el.querySelector('.pb-content') as HTMLElement).focus();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));

      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', text);
      host.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { target, html, text },
  );
  await page.waitForTimeout(150);
}

const TWO_BLOCK_HTML = '<meta charset="utf-8"><p>Senior Software Engineer</p><p>Acme Corporation</p>';
const TWO_BLOCK_TEXT = 'Senior Software Engineer\nAcme Corporation';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
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
  await expect(page.locator('[data-pb="entry"]').first()).toBeVisible();
});

test.describe('Pasting multi-block content into a single-line field', () => {
  test('lands inside the entry title and leaves the entry structure intact', async () => {
    const before = await entries();
    expect(before.length).toBeGreaterThan(0);
    const descriptionShape = before[0].children.map((c) => c.type);

    await pasteBlocksAt({ entryIndex: 0, field: 'entry-title' }, TWO_BLOCK_HTML, TWO_BLOCK_TEXT);

    const after = await entries();
    expect(after.length).toBe(before.length);
    // Both blocks flattened into the title field itself.
    expect(after[0].attrs.title).toBe('Senior Software Engineer Acme Corporation' + before[0].attrs.title);
    // Dates survive and no stray block was spliced into the entry.
    expect(after[0].attrs.dates).toBe(before[0].attrs.dates);
    expect(after[0].children.map((c) => c.type)).toEqual(descriptionShape);
  });

  test('lands inside the entry dates field without splitting the entry', async () => {
    const before = await entries();
    const descriptionShape = before[0].children.map((c) => c.type);

    await pasteBlocksAt({ entryIndex: 0, field: 'entry-dates' }, TWO_BLOCK_HTML, TWO_BLOCK_TEXT);

    const after = await entries();
    expect(after.length).toBe(before.length);
    expect(after[0].attrs.title).toBe(before[0].attrs.title);
    expect(after[0].attrs.dates).toBe('Senior Software Engineer Acme Corporation' + before[0].attrs.dates);
    expect(after[0].children.map((c) => c.type)).toEqual(descriptionShape);
  });

  test('lands inside a title without spilling blocks to the document root', async () => {
    const before = await rootChildren();
    const firstTitle = before.find((c) => c.type === 'title');
    expect(firstTitle).toBeTruthy();

    await pasteBlocksAt({ titleIndex: 0 }, TWO_BLOCK_HTML, TWO_BLOCK_TEXT);

    const after = await rootChildren();
    // No extra root-level block appeared.
    expect(after.length).toBe(before.length);
    expect(after.map((c) => c.type)).toEqual(before.map((c) => c.type));
    const title = after.find((c) => c.type === 'title') as TitleModel;
    expect(title.attrs.text).toBe('Senior Software Engineer Acme Corporation' + firstTitle!.attrs.text);
  });

  test('still allows rich block paste into an entry description', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('applysy-profile-builder') as Element;
      const desc = el.querySelectorAll('[data-pb="entry"]')[0].querySelector('p') as Element;
      const span = desc.querySelector('span[data-lexical-text]') ?? desc;
      const node = span.firstChild ?? span;
      const range = document.createRange();
      range.setStart(node, 0);
      range.collapse(true);
      const sel = window.getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(range);
      (el.querySelector('.pb-content') as HTMLElement).focus();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));

      const data = new DataTransfer();
      data.setData('text/html', '<meta charset="utf-8"><p>Led the team.</p><ul><li>Shipped editor</li></ul>');
      data.setData('text/plain', 'Led the team.\nShipped editor');
      desc.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(150);

    const after = await entries();
    // The list block is preserved and nested inside the entry, not flattened.
    expect(after[0].children.map((c) => c.type)).toContain('list');
  });
});
