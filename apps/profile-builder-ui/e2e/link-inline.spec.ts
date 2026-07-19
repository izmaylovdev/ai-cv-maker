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

// --- US-EDIT-22 helpers ----------------------------------------------------

type Run = { text: string; url?: string };

/**
 * Replace the whole document with a single title + one paragraph built from
 * `runs` (a run with a `url` becomes an `inlineLink`, otherwise `text`).
 * Seeding the state directly is deliberate: §16 needs a link whose label does
 * NOT mirror its URL, and one that is its paragraph's LAST child — neither is
 * reachable through the toolbar in a single step.
 */
async function seedParagraph(runs: Run[]) {
  await page.evaluate((json) => {
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { header: unknown; body: unknown };
    };
    const header = el.document.header;
    const children = (JSON.parse(json) as Run[]).map((r, i) =>
      r.url === undefined
        ? { type: 'text', id: `pb-seed-t${i}`, attrs: { text: r.text } }
        : { type: 'inlineLink', id: `pb-seed-l${i}`, attrs: { text: r.text, url: r.url } },
    );
    el.document = {
      header,
      body: {
        type: 'root',
        id: 'pb-seed-root',
        children: [
          { type: 'title', id: 'pb-seed-title', attrs: { text: 'Summary' } },
          { type: 'paragraph', id: 'pb-seed-para', children },
        ],
      },
    };
  }, JSON.stringify(runs));
  await page.waitForTimeout(150);
}

/** The first paragraph's runs, in document order. */
async function paragraphRuns(): Promise<Run[]> {
  return page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: { type: string; attrs?: Record<string, string> ; children?: unknown[] }[] } };
    };
    const para = (el.document.body.children ?? []).find((c) => c.type === 'paragraph');
    return ((para?.children ?? []) as { type: string; attrs?: Record<string, string> }[]).map((c) =>
      c.type === 'inlineLink'
        ? { text: c.attrs?.['text'] ?? '', url: c.attrs?.['url'] ?? '' }
        : { text: c.attrs?.['text'] ?? '' },
    );
  });
}

/** Collapsed caret inside the rendered <a> whose visible label is `label`. */
async function caretInsideLink(label: string) {
  await page.evaluate((wanted) => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const anchor = Array.from(el.querySelectorAll('a')).find((a) => a.textContent === wanted);
    if (!anchor) throw new Error(`no rendered inline link with label ${JSON.stringify(wanted)}`);
    const span = anchor.querySelector('span[data-lexical-text]');
    const target = (span?.firstChild ?? anchor.firstChild ?? anchor) as Node;
    const range = document.createRange();
    range.setStart(target, 1);
    range.collapse(true);
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    (el.querySelector('.pb-content') as HTMLElement).focus();
    document.dispatchEvent(new Event('selectionchange'));
  }, label);
  await page.waitForTimeout(100);
}

const textInput = () => page.locator('.pb-inline-link-editor__input--text');
const urlInput = () => page.locator('.pb-inline-link-editor__input--url');
const applyBtn = () => page.locator('.pb-inline-link-editor__btn--apply');
const editorBar = () => page.locator('.pb-inline-link-editor');

/** The bar is gone AND stays gone — catches a same-tick re-open (F-EDIT-22.8). */
async function expectBarStaysClosed() {
  await expect(editorBar()).toHaveCount(0);
  let reopened = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(100);
    if ((await editorBar().count()) > 0) reopened = true;
  }
  expect(reopened, 'the inline-link editor re-opened after ✓').toBe(false);
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

    const input = page.locator('.pb-inline-link-editor__input--url');
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
    await expect(page.locator('.pb-inline-link-editor__input--url')).toBeVisible();

    // Apply with an empty URL → the placeholder link is removed entirely.
    await page.locator('.pb-inline-link-editor__btn--apply').click();

    await expect.poll(async () => (await inlineLinks()).length).toBe(0);
  });
});

// Inline link display text (US-EDIT-22 / spec §16). The floating editor gains a
// Text field beside the URL field, so a link can read "my portfolio" instead of
// exposing a raw URL. The visible label is always `text || url`.
test.describe('Inline link display text (US-EDIT-22)', () => {
  /** "See my |portfolio| here." — label differs from URL, link mid-paragraph. */
  const LABELLED = [
    { text: 'See my ' },
    { text: 'portfolio', url: 'https://me.dev' },
    { text: ' here.' },
  ];
  /** "Find me at |portfolio|" — the link is the paragraph's LAST child. */
  const TRAILING = [{ text: 'Find me at ' }, { text: 'portfolio', url: 'https://me.dev' }];

  test('the editor shows two labelled fields, Link text and Link URL (F-EDIT-22.1)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(editorBar()).toBeVisible();
    await expect(page.locator('[aria-label="Link text"]')).toBeVisible();
    await expect(page.locator('[aria-label="Link URL"]')).toBeVisible();
  });

  test('opening on an existing link pre-fills Text with its label and URL with its URL (F-EDIT-22.2)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(textInput()).toHaveValue('portfolio');
    await expect(urlInput()).toHaveValue('https://me.dev');
  });

  test('a freshly caret-inserted link opens with an empty Text field so mirroring stays live (F-EDIT-22.2)', async () => {
    await seedParagraph([{ text: 'Hello world.' }]);
    await caretInRootParagraph();
    await page.locator('button[aria-label^="Link"]').click();

    await expect(textInput()).toBeVisible();
    await expect(textInput()).toHaveValue('');
    await expect(urlInput()).toHaveValue('');
  });

  test('committing a typed Text sets the visible label, leaving the sentence intact (F-EDIT-22.3)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(textInput()).toBeVisible();
    await textInput().fill('my portfolio');
    await applyBtn().click();

    await expect.poll(paragraphRuns).toEqual([
      { text: 'See my ' },
      { text: 'my portfolio', url: 'https://me.dev' },
      { text: ' here.' },
    ]);
  });

  test('an empty Text on commit falls back to the URL as the label (F-EDIT-22.4)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(textInput()).toBeVisible();
    await textInput().fill('');
    await applyBtn().click();

    await expect.poll(paragraphRuns).toEqual([
      { text: 'See my ' },
      { text: 'https://me.dev', url: 'https://me.dev' },
      { text: ' here.' },
    ]);
  });

  test('a later URL-only edit does not overwrite a user-supplied Text (F-EDIT-22.5)', async () => {
    await seedParagraph(LABELLED);

    await caretInsideLink('portfolio');
    await expect(textInput()).toBeVisible();
    await textInput().fill('my site');
    await applyBtn().click();
    await expect.poll(async () => (await paragraphRuns())[1]).toEqual({
      text: 'my site',
      url: 'https://me.dev',
    });

    // Re-open and change ONLY the URL.
    await caretInsideLink('my site');
    await urlInput().fill('https://other.dev');
    await applyBtn().click();

    await expect.poll(async () => (await paragraphRuns())[1]).toEqual({
      text: 'my site',
      url: 'https://other.dev',
    });
  });

  test('committing an empty URL still removes the link even with Text filled (F-EDIT-22.6)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(textInput()).toBeVisible();
    await textInput().fill('my portfolio');
    await urlInput().fill('');
    await applyBtn().click();

    await expect.poll(async () => (await inlineLinks()).length).toBe(0);
  });

  test('Escape leaves both the label and the URL as they were (F-EDIT-22.7)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(textInput()).toBeVisible();
    await textInput().fill('discarded label');
    await urlInput().fill('https://discarded.dev');
    await urlInput().press('Escape');

    await expect(editorBar()).toHaveCount(0);
    await expect.poll(paragraphRuns).toEqual([
      { text: 'See my ' },
      { text: 'portfolio', url: 'https://me.dev' },
      { text: ' here.' },
    ]);
  });

  test('✓ closes the editor for a mid-paragraph link and it does not re-open (F-EDIT-22.8)', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');
    await expect(editorBar()).toBeVisible();

    await applyBtn().click();

    await expectBarStaysClosed();
  });

  test('✓ closes the editor when the link is the last node in its paragraph (F-EDIT-22.8)', async () => {
    await seedParagraph(TRAILING);
    await caretInsideLink('portfolio');
    await expect(editorBar()).toBeVisible();

    await applyBtn().click();

    await expectBarStaysClosed();
  });

  test('after ✓ the caret sits after the link, so typing extends the sentence (F-EDIT-22.9)', async () => {
    await seedParagraph(TRAILING);
    await caretInsideLink('portfolio');
    await applyBtn().click();
    await expect(editorBar()).toHaveCount(0);

    await page.keyboard.type('!');

    // The typed character lands in the running text, NOT inside the link label.
    await expect.poll(paragraphRuns).toEqual([
      { text: 'Find me at ' },
      { text: 'portfolio', url: 'https://me.dev' },
      { text: '!' },
    ]);
  });
});
