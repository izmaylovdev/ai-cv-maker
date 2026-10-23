import { test, expect, Page } from '@playwright/test';

// Links use Lexical's stock LinkNode (@lexical/link), inline in running text.
//
// One floating link editor (role="dialog") with three modes:
//   • wrap   — mod+K / rail Link with a non-empty selection → URL field
//   • insert — mod+K / rail Link at a collapsed caret      → Text + URL fields
//   • view   — caret inside an existing link               → URL, Edit, Remove
// Nothing is written into the document before confirm (no placeholder link).
// Typed / pasted URLs autolink. The standalone `link` block is retired; legacy
// `link` blocks load as `paragraph > inlineLink`. Assertions read the web
// component's serialized `document` (the source of truth) or the rendered <a>.

const HANDLE = '.pb-rail-handle';
const MOD_K = 'ControlOrMeta+k';

let page: Page;
let seed: string;

type Run = { text: string; url?: string };
type Node = { type: string; id: string; attrs?: Record<string, string>; children?: Node[] };

// ---------------------------------------------------------------------------
// Locators (accessible names from the design: dialog with an aria-label,
// inputs labelled "Link text" / "Link URL").
// ---------------------------------------------------------------------------

const linkDialog = () => page.getByRole('dialog', { name: /link/i });
const textInput = () => linkDialog().getByLabel('Link text');
const urlInput = () => linkDialog().getByLabel('Link URL');
const confirmBtn = () => linkDialog().getByRole('button', { name: /apply|confirm|save/i });
const editBtn = () => linkDialog().getByRole('button', { name: /^edit/i });
const removeBtn = () => linkDialog().getByRole('button', { name: /^remove/i });
const railLink = () => page.locator('.pb-rail button[aria-label^="Link"]');
const contentAnchors = () => page.locator('.pb-content a');

// ---------------------------------------------------------------------------
// Document helpers
// ---------------------------------------------------------------------------

/** All `inlineLink` runs anywhere in the body, as { text, url }. */
async function inlineLinks(): Promise<{ text: string; url: string }[]> {
  return page.evaluate(() => {
    const out: { text: string; url: string }[] = [];
    const walk = (node: { type?: string; attrs?: Record<string, string>; children?: unknown[] }) => {
      if (node.type === 'inlineLink') out.push({ text: node.attrs?.['text'] ?? '', url: node.attrs?.['url'] ?? '' });
      for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: unknown[] } };
    };
    walk(el.document.body as never);
    return out;
  });
}

/** Every node `type` in the body, deep. */
async function allTypes(): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walk = (n: { type: string; children?: unknown[] }) => {
      out.push(n.type);
      for (const c of (n.children ?? []) as (typeof n)[]) walk(c);
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { type: string; children?: unknown[] } };
    };
    walk(el.document.body);
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

/** The first root paragraph's runs, in document order. */
async function paragraphRuns(): Promise<Run[]> {
  return page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { body: { children?: { type: string; children?: unknown[] }[] } };
    };
    const para = (el.document.body.children ?? []).find((c) => c.type === 'paragraph');
    return ((para?.children ?? []) as { type: string; attrs?: Record<string, string> }[]).map((c) =>
      c.type === 'inlineLink'
        ? { text: c.attrs?.['text'] ?? '', url: c.attrs?.['url'] ?? '' }
        : { text: c.attrs?.['text'] ?? '' },
    );
  });
}

/** The first root paragraph's full text (all runs joined). */
async function paragraphText(): Promise<string> {
  return (await paragraphRuns()).map((r) => r.text).join('');
}

/** Replace the body with one title + one paragraph built from `runs`. */
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

/** Replace the whole body with `body` (bypasses typing — legacy shapes allowed). */
async function seedBody(body: unknown) {
  await page.evaluate((json) => {
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { header: unknown; body: unknown };
    };
    el.document = { header: el.document.header, body: JSON.parse(json) };
  }, JSON.stringify(body));
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// Selection helpers (DOM range + selectionchange, so Lexical picks it up)
// ---------------------------------------------------------------------------

/** Select `word` inside the first running-text span (not a title/entry field) containing it. */
async function selectWord(word: string) {
  await page.evaluate((w) => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const span = Array.from(el.querySelectorAll('.pb-content span[data-lexical-text]')).find(
      (s) =>
        !s.closest('[data-pb="title"]') &&
        !s.closest('[data-pb="entry-title"]') &&
        !s.closest('[data-pb="entry-dates"]') &&
        (s.textContent ?? '').includes(w),
    );
    if (!span) throw new Error(`no running-text span containing ${JSON.stringify(w)}`);
    const textNode = span.firstChild as Text;
    const start = (textNode.textContent ?? '').indexOf(w);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + w.length);
    (el.querySelector('.pb-content') as HTMLElement).focus();
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, word);
  await page.waitForTimeout(100);
}

/** Collapsed caret at the END of the first root paragraph. */
async function caretAtParagraphEnd() {
  await page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const p = Array.from(el.querySelectorAll('.pb-content > p')).find(
      (n) => !n.closest('[data-pb="entry"]'),
    ) as Element;
    const spans = p.querySelectorAll('span[data-lexical-text]');
    const last = spans[spans.length - 1];
    const range = document.createRange();
    if (last && last.firstChild) range.setStart(last.firstChild, (last.firstChild.textContent ?? '').length);
    else range.setStart(p, p.childNodes.length);
    range.collapse(true);
    (el.querySelector('.pb-content') as HTMLElement).focus();
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(100);
}

/** Collapsed caret inside the rendered <a> whose label is `label`, at `offset` (default: 1). */
async function caretInsideLink(label: string, offset?: number) {
  await page.evaluate(
    ([wanted, off]) => {
      const el = document.querySelector('applysy-profile-builder') as Element;
      const anchor = Array.from(el.querySelectorAll('.pb-content a')).find((a) => a.textContent === wanted);
      if (!anchor) throw new Error(`no rendered link with label ${JSON.stringify(wanted)}`);
      const span = anchor.querySelector('span[data-lexical-text]');
      const target = (span?.firstChild ?? anchor.firstChild ?? anchor) as Node;
      const range = document.createRange();
      range.setStart(target, off === null ? 1 : (off as number));
      range.collapse(true);
      (el.querySelector('.pb-content') as HTMLElement).focus();
      const sel = window.getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    },
    [label, offset ?? null] as const,
  );
  await page.waitForTimeout(100);
}

/** Collapsed caret at the start of the first title heading. */
async function caretInTitle() {
  await page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const span = el.querySelector('[data-pb="title"] span[data-lexical-text]') as Element;
    const range = document.createRange();
    range.setStart(span.firstChild as Node, 1);
    range.collapse(true);
    (el.querySelector('.pb-content') as HTMLElement).focus();
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(100);
}

/** Collapsed caret at the end of the first timeline entry's description. */
async function caretInFirstEntryDescription() {
  await page.evaluate(() => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const entry = el.querySelector('[data-pb="entry"]') as Element;
    const span = Array.from(entry.querySelectorAll('span[data-lexical-text]')).find(
      (s) => !s.closest('[data-pb="entry-title"]') && !s.closest('[data-pb="entry-dates"]'),
    ) as Element;
    const range = document.createRange();
    range.setStart(span.firstChild as Node, (span.textContent ?? '').length);
    range.collapse(true);
    (el.querySelector('.pb-content') as HTMLElement).focus();
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(100);
}

/** Dispatch a plain-text paste at the current selection. */
async function pastePlainText(text: string) {
  await page.evaluate((t) => {
    const el = document.querySelector('applysy-profile-builder') as Element;
    const editable = el.querySelector('.pb-content') as HTMLElement;
    const data = new DataTransfer();
    data.setData('text/plain', t);
    editable.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// documentchange recorder
// ---------------------------------------------------------------------------

async function clearChanges() {
  await page.evaluate(() => {
    (window as unknown as { __pbChanges: unknown[] }).__pbChanges = [];
  });
}

async function changes(): Promise<{ body: Node }[]> {
  return page.evaluate(() => (window as unknown as { __pbChanges: { body: Node }[] }).__pbChanges);
}

// ---------------------------------------------------------------------------

const LABELLED: Run[] = [{ text: 'See my ' }, { text: 'portfolio', url: 'https://me.dev' }, { text: ' here.' }];
const TRAILING: Run[] = [{ text: 'Find me at ' }, { text: 'portfolio', url: 'https://me.dev' }];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
  seed = await page.evaluate(() =>
    JSON.stringify((document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document),
  );
  await page.evaluate(() => {
    const w = window as unknown as { __pbChanges: unknown[] };
    w.__pbChanges = [];
    document.querySelector('applysy-profile-builder')!.addEventListener('documentchange', (e) => {
      w.__pbChanges.push(JSON.parse(JSON.stringify((e as CustomEvent).detail)));
    });
  });
});

test.afterAll(async () => {
  await page.close();
});

test.beforeEach(async () => {
  // Close any link editor left open by the previous test.
  await page.keyboard.press('Escape');
  await page.evaluate((s) => {
    (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document = JSON.parse(s);
  }, seed);
  await expect(page.locator('.pb-content')).toBeVisible();
});

test.describe('Wrap a selection in a link', () => {
  test('mod+K on a selected word opens the link editor; confirming makes that word a link', async () => {
    await seedParagraph([{ text: 'Hello world here.' }]);
    await selectWord('world');

    await page.keyboard.press(MOD_K);
    await expect(linkDialog()).toBeVisible();
    await expect(urlInput()).toBeVisible();
    await urlInput().fill('https://world.dev');
    await urlInput().press('Enter');

    await expect(linkDialog()).toHaveCount(0);
    await expect.poll(paragraphRuns).toEqual([
      { text: 'Hello ' },
      { text: 'world', url: 'https://world.dev' },
      { text: ' here.' },
    ]);
    await expect(page.locator('.pb-content a[href="https://world.dev"]')).toHaveText('world');
  });

  test('the rail Link button on a selected word wraps it the same way', async () => {
    await seedParagraph([{ text: 'Hello world here.' }]);
    await selectWord('world');

    await railLink().click();
    await expect(urlInput()).toBeVisible();
    await urlInput().fill('https://world.dev');
    await urlInput().press('Enter');

    await expect.poll(inlineLinks).toEqual([{ text: 'world', url: 'https://world.dev' }]);
  });

  test('pasting a URL over a selection wraps the selection in a link', async () => {
    await seedParagraph([{ text: 'Hello world here.' }]);
    await selectWord('world');

    await pastePlainText('https://world.dev');

    await expect.poll(paragraphRuns).toEqual([
      { text: 'Hello ' },
      { text: 'world', url: 'https://world.dev' },
      { text: ' here.' },
    ]);
  });
});

test.describe('Insert a link at the caret', () => {
  test('mod+K at a collapsed caret asks for Text and URL and inserts the link on confirm', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    await caretAtParagraphEnd();

    await page.keyboard.press(MOD_K);
    await expect(linkDialog()).toBeVisible();
    await expect(textInput()).toBeVisible();
    await expect(urlInput()).toBeVisible();
    await textInput().fill('my site');
    await urlInput().fill('https://me.dev');
    await urlInput().press('Enter');

    await expect(linkDialog()).toHaveCount(0);
    await expect.poll(paragraphRuns).toEqual([{ text: 'Find me at ' }, { text: 'my site', url: 'https://me.dev' }]);
    await expect(page.locator('.pb-content a[href="https://me.dev"]')).toHaveText('my site');
  });

  test('after an insert, typing continues as plain text right after the new link', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    await caretAtParagraphEnd();

    await railLink().click();
    await textInput().fill('my site');
    await urlInput().fill('https://me.dev');
    await urlInput().press('Enter');
    await expect(linkDialog()).toHaveCount(0);

    await page.keyboard.type('!');

    await expect.poll(paragraphRuns).toEqual([
      { text: 'Find me at ' },
      { text: 'my site', url: 'https://me.dev' },
      { text: '!' },
    ]);
  });

  test('an empty Text uses the URL as the visible label', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    await caretAtParagraphEnd();

    await railLink().click();
    await urlInput().fill('https://me.dev');
    await urlInput().press('Enter');

    await expect.poll(inlineLinks).toEqual([{ text: 'https://me.dev', url: 'https://me.dev' }]);
  });

  test('cancelling an insert writes nothing — no placeholder link ever appears', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    await caretAtParagraphEnd();

    await page.keyboard.press(MOD_K);
    await expect(linkDialog()).toBeVisible();
    // While the editor is open, nothing has been written into the document.
    await expect(contentAnchors()).toHaveCount(0);
    expect(await inlineLinks()).toEqual([]);

    await textInput().fill('discarded');
    await urlInput().fill('https://discarded.dev');
    await urlInput().press('Escape');

    await expect(linkDialog()).toHaveCount(0);
    await expect(contentAnchors()).toHaveCount(0);
    expect(await inlineLinks()).toEqual([]);
    expect(await paragraphRuns()).toEqual([{ text: 'Find me at ' }]);
  });
});

test.describe('URL validation and normalisation', () => {
  test('a javascript: URL is rejected — confirm is disabled and an inline error is shown', async () => {
    await seedParagraph([{ text: 'Hello world here.' }]);
    await selectWord('world');

    await page.keyboard.press(MOD_K);
    await urlInput().fill('javascript:alert(1)');

    await expect(confirmBtn()).toBeDisabled();
    await expect(linkDialog()).toContainText('Enter a valid URL');
    await urlInput().press('Enter');
    expect(await inlineLinks()).toEqual([]);
  });

  test('a bare domain gets https:// prepended', async () => {
    await seedParagraph([{ text: 'Hello world here.' }]);
    await selectWord('world');

    await page.keyboard.press(MOD_K);
    await urlInput().fill('example.com');
    await urlInput().press('Enter');

    await expect.poll(inlineLinks).toEqual([{ text: 'world', url: 'https://example.com' }]);
  });
});

test.describe('View, edit and remove an existing link', () => {
  test('moving the caret into a link opens the editor in view mode: URL, Edit, Remove', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await expect(linkDialog()).toBeVisible();
    const shown = linkDialog().getByRole('link', { name: 'https://me.dev' });
    await expect(shown).toBeVisible();
    await expect(shown).toHaveAttribute('href', 'https://me.dev');
    await expect(shown).toHaveAttribute('target', '_blank');
    await expect(editBtn()).toBeVisible();
    await expect(removeBtn()).toBeVisible();
    // The label is edited in the document, not in the view popover.
    await expect(textInput()).toHaveCount(0);
  });

  test('Edit lets you change the URL; the label stays the same', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await editBtn().click();
    await expect(urlInput()).toHaveValue('https://me.dev');
    await urlInput().fill('https://other.dev');
    await urlInput().press('Enter');

    await expect.poll(paragraphRuns).toEqual([
      { text: 'See my ' },
      { text: 'portfolio', url: 'https://other.dev' },
      { text: ' here.' },
    ]);
  });

  test('Escape in edit mode leaves the link unchanged', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await editBtn().click();
    await urlInput().fill('https://discarded.dev');
    await urlInput().press('Escape');

    await expect(linkDialog()).toHaveCount(0);
    expect(await inlineLinks()).toEqual([{ text: 'portfolio', url: 'https://me.dev' }]);
  });

  test('Remove unwraps the link and leaves its text behind as plain text', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await removeBtn().click();

    await expect.poll(inlineLinks).toEqual([]);
    expect(await paragraphText()).toBe('See my portfolio here.');
    await expect(contentAnchors()).toHaveCount(0);
  });

  test('confirming an empty URL in edit mode removes the link, keeping the text', async () => {
    await seedParagraph(LABELLED);
    await caretInsideLink('portfolio');

    await editBtn().click();
    await urlInput().fill('');
    await urlInput().press('Enter');

    await expect.poll(inlineLinks).toEqual([]);
    expect(await paragraphText()).toBe('See my portfolio here.');
  });
});

test.describe('Typing next to a link', () => {
  test('typing right after a link continues as plain text and does not extend the link', async () => {
    await seedParagraph(TRAILING);
    // Caret at the very end of the link label ("portfolio".length).
    await caretInsideLink('portfolio', 'portfolio'.length);

    await page.keyboard.type(' now');

    await expect.poll(paragraphRuns).toEqual([
      { text: 'Find me at ' },
      { text: 'portfolio', url: 'https://me.dev' },
      { text: ' now' },
    ]);
  });
});

test.describe('Autolink', () => {
  test('typing a full URL followed by a space turns it into a link', async () => {
    await seedParagraph([{ text: 'Visit ' }]);
    await caretAtParagraphEnd();

    await page.keyboard.type('https://example.com ');

    await expect.poll(inlineLinks).toEqual([{ text: 'https://example.com', url: 'https://example.com' }]);
    await expect(page.locator('.pb-content a[href="https://example.com"]')).toHaveText('https://example.com');
  });

  test('pasting a full URL into a paragraph turns it into a link', async () => {
    await seedParagraph([{ text: 'Visit ' }]);
    await caretAtParagraphEnd();

    await pastePlainText('https://example.com');

    await expect.poll(inlineLinks).toEqual([{ text: 'https://example.com', url: 'https://example.com' }]);
  });
});

test.describe('Rail: Link is a text action, not a block widget', () => {
  test('the rail Link button exists but adds no new block line — the link lands inside the paragraph', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    const rootBefore = await rootChildTypes();
    await expect(railLink()).toBeVisible();

    await caretAtParagraphEnd();
    await railLink().click();
    // Opening the editor inserts nothing.
    expect(await rootChildTypes()).toEqual(rootBefore);
    await urlInput().fill('https://me.dev');
    await urlInput().press('Enter');

    await expect.poll(inlineLinks).toEqual([{ text: 'https://me.dev', url: 'https://me.dev' }]);
    expect(await rootChildTypes()).toEqual(rootBefore);
    expect(await allTypes()).not.toContain('link');
  });

  test('inside a timeline entry description the Link button inserts an inline link in that entry', async () => {
    const rootBefore = await rootChildTypes();
    await caretInFirstEntryDescription();
    await expect(railLink()).toBeEnabled();

    await railLink().click();
    await urlInput().fill('https://case.dev');
    await urlInput().press('Enter');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.querySelector('applysy-profile-builder') as unknown as { document: { body: Node } };
          const find = (n: Node): Node | undefined =>
            n.type === 'entry' ? n : (n.children ?? []).map(find).find(Boolean);
          const entry = find(el.document.body);
          const walk = (n: Node): string[] => [n.type, ...(n.children ?? []).flatMap(walk)];
          return entry ? walk(entry) : [];
        }),
      )
      .toContain('inlineLink');
    expect(await rootChildTypes()).toEqual(rootBefore);
    expect(await allTypes()).not.toContain('link');
  });

  test('in a title the Link button is disabled and mod+K opens no link editor', async () => {
    await seedParagraph([{ text: 'Hello.' }]);
    await caretInTitle();

    await expect(railLink()).toBeDisabled();
    await page.keyboard.press(MOD_K);
    await page.waitForTimeout(200);
    await expect(linkDialog()).toHaveCount(0);
    expect(await inlineLinks()).toEqual([]);
  });
});

test.describe('Legacy standalone link blocks', () => {
  const LEGACY_BODY = {
    type: 'root',
    id: 'legacy-root',
    children: [
      { type: 'title', id: 'legacy-title', attrs: { text: 'Links' } },
      { type: 'link', id: 'legacy-root-link', attrs: { text: 'Portfolio', url: 'https://example.com' } },
      { type: 'title', id: 'legacy-title-2', attrs: { text: 'Work Experience' } },
      {
        type: 'timeline',
        id: 'legacy-tl',
        children: [
          {
            type: 'entry',
            id: 'legacy-entry',
            attrs: { title: 'Engineer · Acme', dates: '2022 – Present' },
            children: [
              {
                type: 'paragraph',
                id: 'legacy-entry-p',
                children: [{ type: 'text', id: 'legacy-entry-t', attrs: { text: 'Led the team.' } }],
              },
              { type: 'link', id: 'legacy-entry-link', attrs: { text: 'Case study', url: 'https://case.dev' } },
            ],
          },
        ],
      },
    ],
  };

  test('a root-level and an entry-level link block load as paragraphs holding the same link', async () => {
    await seedBody(LEGACY_BODY);

    const rootAnchor = page.locator('.pb-content p a[href="https://example.com"]');
    await expect(rootAnchor).toHaveText('Portfolio');
    const entryAnchor = page.locator('.pb-content [data-pb="entry"] p a[href="https://case.dev"]');
    await expect(entryAnchor).toHaveText('Case study');
    // The retired link-line widget is not rendered.
    await expect(page.locator('.pb-content [data-pb="link"]')).toHaveCount(0);
  });

  test('the emitted documentchange contains inlineLink runs and no link block', async () => {
    await clearChanges();
    await seedBody(LEGACY_BODY);

    await expect.poll(async () => (await changes()).length).toBeGreaterThan(0);
    const last = (await changes()).at(-1)!;
    const walk = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(walk)];
    const nodes = walk(last.body);
    expect(nodes.map((n) => n.type)).not.toContain('link');
    const links = nodes.filter((n) => n.type === 'inlineLink');
    expect(links.map((l) => l.attrs)).toEqual([
      { text: 'Portfolio', url: 'https://example.com' },
      { text: 'Case study', url: 'https://case.dev' },
    ]);
    // The paragraph takes over the legacy link's id.
    const rootPara = nodes.find((n) => n.id === 'legacy-root-link');
    expect(rootPara?.type).toBe('paragraph');
  });

  test('inlineLink ids are non-empty and stay the same across two consecutive documentchange events', async () => {
    await clearChanges();
    await seedBody(LEGACY_BODY);
    await expect.poll(async () => (await changes()).length).toBeGreaterThan(0);

    // A second, unrelated edit produces another documentchange.
    await caretInTitle();
    await page.keyboard.type('X');
    await expect.poll(async () => (await changes()).length).toBeGreaterThan(1);

    const all = await changes();
    const ids = (c: { body: Node }) => {
      const walk = (n: Node): Node[] => [n, ...(n.children ?? []).flatMap(walk)];
      return walk(c.body)
        .filter((n) => n.type === 'inlineLink')
        .map((n) => n.id);
    };
    const prev = ids(all[all.length - 2]);
    const last = ids(all[all.length - 1]);
    expect(prev).toHaveLength(2);
    expect(prev.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(last).toEqual(prev);
  });

  test('the migrated document survives save → reload with the same text and url', async () => {
    await clearChanges();
    await seedBody(LEGACY_BODY);
    await expect.poll(async () => (await changes()).length).toBeGreaterThan(0);
    const saved = (await changes()).at(-1)!;

    // "Reload": seed the component with exactly what it emitted.
    await page.evaluate((json) => {
      (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document =
        JSON.parse(json);
    }, JSON.stringify(saved));
    await page.waitForTimeout(150);

    await expect(page.locator('.pb-content p a[href="https://example.com"]')).toHaveText('Portfolio');
    await expect(page.locator('.pb-content [data-pb="entry"] p a[href="https://case.dev"]')).toHaveText('Case study');
    expect(await inlineLinks()).toEqual([
      { text: 'Portfolio', url: 'https://example.com' },
      { text: 'Case study', url: 'https://case.dev' },
    ]);
  });
});

// Keyboard-only flows: no clicks into the link editor's inputs, so these pin that
// the form takes focus itself, that Escape works from the document, and that a
// typed URL survives AutoLink's mid-typing link/unlink cycle as one run.
test.describe('regressions found in browser verification', () => {
  test('select a word, mod+K, type a URL, Enter: the word is linked and the text around it is intact', async () => {
    await seedParagraph([{ text: 'Hello Acme world' }]);
    await selectWord('Acme');

    await page.keyboard.press(MOD_K);
    await expect(urlInput()).toBeFocused();
    await page.keyboard.type('https://acme.com');
    await page.keyboard.press('Enter');

    await expect(linkDialog()).toHaveCount(0);
    await expect.poll(paragraphRuns).toEqual([
      { text: 'Hello ' },
      { text: 'Acme', url: 'https://acme.com' },
      { text: ' world' },
    ]);
  });

  test('collapsed caret, mod+K, type text, Tab, type URL, Enter: the link is inserted', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    await caretAtParagraphEnd();

    await page.keyboard.press(MOD_K);
    await expect(textInput()).toBeFocused();
    await page.keyboard.type('my site');
    await page.keyboard.press('Tab');
    await expect(urlInput()).toBeFocused();
    await page.keyboard.type('https://me.dev');
    await page.keyboard.press('Enter');

    await expect(linkDialog()).toHaveCount(0);
    await expect.poll(paragraphRuns).toEqual([{ text: 'Find me at ' }, { text: 'my site', url: 'https://me.dev' }]);
  });

  test('mod+K then Escape straight away closes the editor, inserts nothing, and keeps focus in the document', async () => {
    await seedParagraph([{ text: 'Find me at ' }]);
    await caretAtParagraphEnd();

    await page.keyboard.press(MOD_K);
    await expect(linkDialog()).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(linkDialog()).toHaveCount(0);
    await expect(page.locator('.pb-content')).toBeFocused();
    expect(await inlineLinks()).toEqual([]);
    expect(await paragraphRuns()).toEqual([{ text: 'Find me at ' }]);
  });

  test('typing a URL with a long host label autolinks it as one link, without fragmenting the text', async () => {
    await seedParagraph([{ text: 'Go ' }]);
    await caretAtParagraphEnd();
    await clearChanges();

    await page.keyboard.type('https://www.linkedin.com/in/jane ');

    await expect(page.locator('.pb-content a[href="https://www.linkedin.com/in/jane"]')).toHaveCount(1);
    await expect
      .poll(inlineLinks)
      .toEqual([{ text: 'https://www.linkedin.com/in/jane', url: 'https://www.linkedin.com/in/jane' }]);
    const last = (await changes()).at(-1)!;
    const para = (last.body.children ?? []).find((c) => c.type === 'paragraph')!;
    expect((para.children ?? []).length).toBeLessThanOrEqual(3);
  });
});
