import { test, expect, Page } from '@playwright/test';

// Empty-region placeholders vs. real content (US-EDIT-23).
//
// A timeline entry shows ghost hints while its description / title / dates are
// empty. Committing an inline link leaves a trailing empty text span behind on
// purpose — it is the caret's landing spot after the link (US-EDIT-22) — so a
// placeholder rule keyed on "contains an empty text span" fired on paragraphs
// that were full of text, rendering the hint in front of the user's prose and
// growing the entry by a line.
//
// These tests assert the rendered ::before, not the CSS source, so they hold
// whichever way the emptiness test is expressed.

const HANDLE = '.pb-rail-handle';
const DESC_HINT = 'Describe it — scope, impact, results…';

let page: Page;

type Run = { text: string; url?: string };

/** Replace the document with one timeline entry built from `runs`. */
async function seedEntry(opts: { title?: string; dates?: string; runs?: Run[] } = {}) {
  await page.evaluate((json) => {
    const { title, dates, runs } = JSON.parse(json) as {
      title: string;
      dates: string;
      runs: Run[];
    };
    const el = document.querySelector('applysy-profile-builder') as unknown as {
      document: { header: unknown; body: unknown };
    };
    el.document = {
      header: el.document.header,
      body: {
        type: 'root',
        id: 'pb-seed-root',
        children: [
          { type: 'title', id: 'pb-seed-title', attrs: { text: 'Work Experience' } },
          {
            type: 'timeline',
            id: 'pb-seed-timeline',
            children: [
              {
                type: 'entry',
                id: 'pb-seed-entry',
                attrs: { title, dates },
                children: [
                  {
                    type: 'paragraph',
                    id: 'pb-seed-desc',
                    children: runs.map((r, i) =>
                      r.url === undefined
                        ? { type: 'text', id: `pb-seed-t${i}`, attrs: { text: r.text } }
                        : {
                            type: 'inlineLink',
                            id: `pb-seed-l${i}`,
                            attrs: { text: r.text, url: r.url },
                          },
                    ),
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  }, JSON.stringify({ title: opts.title ?? 'Senior Engineer · Acme Inc.', dates: opts.dates ?? 'Jan 2022 – Present', runs: opts.runs ?? [{ text: '' }] }));
  await page.waitForTimeout(150);
}

/** The rendered ::before text of `selector`, or null when no hint renders. */
async function hintOf(selector: string): Promise<string | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element for ${sel}`);
    const content = getComputedStyle(el, '::before').content;
    if (!content || content === 'none' || content === 'normal') return null;
    return content.replace(/^["']|["']$/g, '');
  }, selector);
}

const DESC = '[data-pb="entry"] > p.pb-paragraph:last-child';
const ENTRY_TITLE = '[data-pb="entry-title"]';

/** Height of the entry's description paragraph, in CSS px. */
async function descHeight(): Promise<number> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect().height,
    DESC,
  );
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(HANDLE).first().waitFor({ timeout: 90_000 });
});

test.afterAll(async () => {
  await page.close();
});

test.describe('Entry placeholders vs. real content (US-EDIT-23)', () => {
  test('a description holding text and a link shows no ghost hint', async () => {
    await seedEntry({
      runs: [
        { text: 'Lead the web platform team; shipped the new editor.' },
        { text: 'https://example.com/careers', url: 'https://example.com/careers' },
      ],
    });

    expect(await hintOf(DESC)).toBeNull();
    // The hint is an in-flow ::before, so if it rendered it would also push the
    // paragraph onto a second line. One line here means it really is absent.
    expect(await descHeight()).toBeLessThan(40);
  });

  test('a description holding only a link shows no ghost hint', async () => {
    await seedEntry({
      runs: [{ text: 'portfolio', url: 'https://example.com' }],
    });

    expect(await hintOf(DESC)).toBeNull();
  });

  test('a genuinely empty description still shows its hint', async () => {
    await seedEntry({ runs: [{ text: '' }] });

    expect(await hintOf(DESC)).toBe(DESC_HINT);
  });

  test('the hint clears once the description has text', async () => {
    await seedEntry({ runs: [{ text: '' }] });
    expect(await hintOf(DESC)).toBe(DESC_HINT);

    await page.locator(DESC).click();
    await page.keyboard.type('Shipped it.');
    await page.waitForTimeout(120);

    expect(await hintOf(DESC)).toBeNull();
  });

  test('an entry title holding text shows no ghost hint', async () => {
    // Entry title/dates cannot hold an inline link at all — caretAllowsInlineLink
    // refuses one there (spec §15 out of scope), so the link-tail span that broke
    // descriptions cannot reach them. Their placeholders use the same emptiness
    // test regardless; this pins that the rewrite kept them working.
    await seedEntry({ title: 'Senior Engineer · Acme Inc.', runs: [{ text: 'x' }] });

    expect(await hintOf(ENTRY_TITLE)).toBeNull();
    expect(await hintOf('[data-pb="entry-dates"]')).toBeNull();
  });

  test('an empty entry title still shows its hint', async () => {
    await seedEntry({ title: '', runs: [{ text: 'x' }] });

    expect(await hintOf(ENTRY_TITLE)).toBe('Title — role, degree, or project');
  });

  test('committing a link through the toolbar leaves the description intact', async () => {
    await seedEntry({ runs: [{ text: 'Lead the web platform team.' }] });
    const before = await descHeight();

    await page.locator(DESC).click();
    await page.keyboard.press('End');
    await page.locator('button[aria-label^="Link"]').click();
    await page.locator('.pb-inline-link-editor__input--url').fill('https://example.com/careers');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    expect(await hintOf(DESC)).toBeNull();
    // The link text is short enough to stay on the same line, so the paragraph
    // must not have grown at all.
    expect(await descHeight()).toBe(before);
  });

  test('the committed link really does leave an empty text span behind', async () => {
    // Pins the mechanism the fix is about. If a future change stops emitting the
    // caret-landing span, the toolbar test above would start passing for the
    // wrong reason and this one fails loudly instead.
    await seedEntry({ runs: [{ text: 'Lead the web platform team.' }] });

    await page.locator(DESC).click();
    await page.keyboard.press('End');
    await page.locator('button[aria-label^="Link"]').click();
    await page.locator('.pb-inline-link-editor__input--url').fill('https://example.com');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const emptySpans = await page.evaluate(
      (sel) =>
        Array.from(document.querySelectorAll(`${sel} > span[data-lexical-text]`)).filter(
          (s) => s.textContent === '',
        ).length,
      DESC,
    );
    expect(emptySpans).toBeGreaterThan(0);
  });
});
