import { test, expect, Page } from '@playwright/test';

// Timeline entry drag-and-drop reorder.
//
// Each entry of a timeline with 2+ entries gets a drag handle (⠿,
// `.pb-entry-handle`, "Drag to reorder entry") in the left gutter next to its
// Title field, alongside the ✕. Dragging the handle (pointer-based: mousedown →
// window mousemove → mouseup, same as title-dnd.spec.ts — no native HTML5 DnD)
// moves the entry within its own timeline only; its fields and nested content
// move with it. Escape mid-drag cancels.
//
// The page is loaded once and reset between tests by assigning the element's
// `document` property. Order is asserted both in the DOM (entry-title text) and
// in the element's serialized `document` (the persisted shape).

const SECTION_HANDLE = '.pb-rail-handle';
const ENTRY_HANDLE = '.pb-entry-handle';
const TITLE = '.pb-content [data-pb="title"]';
const TIMELINE = '.pb-content [data-pb="timeline"]';
const ENTRY = '.pb-content [data-pb="entry"]';
const ENTRY_TITLE = '[data-pb="entry-title"]';
const DROP_LINE = '.pb-drop-line';
const GHOST = '.pb-drag-ghost';
const FLOATING_GHOST = '.pb-drag-ghost.pb-drag-ghost--floating';

interface Node {
  type: string;
  id: string;
  attrs?: Record<string, string>;
  children?: Node[];
}
interface Doc {
  header: Record<string, string>;
  body: Node;
}

const text = (id: string, t: string): Node => ({ type: 'text', id, attrs: { text: t } });
const para = (id: string, t: string): Node => ({ type: 'paragraph', id, children: [text(`${id}-t`, t)] });

// Experience: three entries (Alpha has a nested list, Beta has chips).
// Education: a single entry — must get no drag handle.
const SEED_DOC: Doc = {
  header: {
    fullName: 'Test User',
    title: 'Engineer',
    email: 'test@example.com',
    phone: '',
    location: '',
  },
  body: {
    type: 'root',
    id: 'root',
    children: [
      { type: 'title', id: 't-exp', attrs: { text: 'Experience' } },
      {
        type: 'timeline',
        id: 'tl-exp',
        children: [
          {
            type: 'entry',
            id: 'e-alpha',
            attrs: { title: 'Alpha Corp', dates: '2018 – 2020' },
            children: [
              para('p-alpha', 'Alpha description.'),
              {
                type: 'list',
                id: 'l-alpha',
                children: [
                  { type: 'listItem', id: 'li-alpha-1', children: [para('p-alpha-li-1', 'Led the migration')] },
                  { type: 'listItem', id: 'li-alpha-2', children: [para('p-alpha-li-2', 'Mentored juniors')] },
                ],
              },
            ],
          },
          {
            type: 'entry',
            id: 'e-beta',
            attrs: { title: 'Beta Inc', dates: '2020 – 2022' },
            children: [
              para('p-beta', 'Beta description.'),
              {
                type: 'chips',
                id: 'c-beta',
                children: [
                  { type: 'chip', id: 'ch-beta-1', attrs: { text: 'Kotlin' } },
                  { type: 'chip', id: 'ch-beta-2', attrs: { text: 'Kafka' } },
                ],
              },
            ],
          },
          {
            type: 'entry',
            id: 'e-gamma',
            attrs: { title: 'Gamma LLC', dates: '2022 – Present' },
            children: [para('p-gamma', 'Gamma description.')],
          },
        ],
      },
      { type: 'title', id: 't-edu', attrs: { text: 'Education' } },
      {
        type: 'timeline',
        id: 'tl-edu',
        children: [
          {
            type: 'entry',
            id: 'e-omega',
            attrs: { title: 'Omega University', dates: '2014 – 2018' },
            children: [para('p-omega', 'Omega description.')],
          },
        ],
      },
    ],
  },
};

const INITIAL_ENTRIES = ['Alpha Corp', 'Beta Inc', 'Gamma LLC'];
const INITIAL_TITLES = ['Experience', 'Education'];

let page: Page;
/** The seed as the component serializes it back (normalized round trip). */
let seed: string;

async function setDocument(doc: unknown) {
  await page.evaluate((d) => {
    (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document = d;
  }, doc);
}

async function readDoc(): Promise<Doc> {
  return page.evaluate(
    () =>
      JSON.parse(
        JSON.stringify(
          (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document,
        ),
      ) as Doc,
  );
}

function firstTimeline(doc: Doc): Node {
  const tl = (doc.body.children ?? []).find((c) => c.type === 'timeline');
  if (!tl) throw new Error('no timeline in document');
  return tl;
}

/** `baseline` with its first timeline's entries rearranged into `ids` order — nothing else changed. */
function withFirstTimelineOrder(baseline: Doc, ids: string[]): Doc {
  const next = JSON.parse(JSON.stringify(baseline)) as Doc;
  const tl = firstTimeline(next);
  const byId = new Map((tl.children ?? []).map((e) => [e.id, e]));
  tl.children = ids.map((id) => {
    const e = byId.get(id);
    if (!e) throw new Error(`no entry ${id}`);
    return e;
  });
  return next;
}

async function entryOrder(): Promise<string[]> {
  return page
    .locator(TIMELINE)
    .first()
    .locator(ENTRY_TITLE)
    .allTextContents()
    .then((t) => t.map((s) => s.trim()));
}

async function titleOrder(): Promise<string[]> {
  return page.locator(TITLE).allTextContents().then((t) => t.map((s) => s.trim()));
}

async function boxOf(locator: ReturnType<Page['locator']>, what: string) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no bounding box for ${what}`);
  return box;
}

/** Bounding box of the Title field of entry `nth` (document order, across all timelines). */
async function entryTitleBox(nth: number) {
  return boxOf(page.locator(ENTRY).nth(nth).locator(ENTRY_TITLE), `entry-title #${nth}`);
}

/**
 * The drag handle belonging to entry `nth`: the `.pb-entry-handle` vertically
 * centred on that entry's Title field (the same anchor the ✕ uses).
 */
async function entryHandle(nth: number) {
  await page.locator(ENTRY_HANDLE).first().waitFor({ state: 'attached', timeout: 5_000 });
  const title = await entryTitleBox(nth);
  const titleY = title.y + title.height / 2;
  const handles = page.locator(ENTRY_HANDLE);
  const count = await handles.count();
  for (let i = 0; i < count; i++) {
    const box = await handles.nth(i).boundingBox();
    if (box && Math.abs(box.y + box.height / 2 - titleY) <= 12) return handles.nth(i);
  }
  return null;
}

async function pointInEntry(nth: number, frac: number) {
  const box = await boxOf(page.locator(ENTRY).nth(nth), `entry #${nth}`);
  return { x: box.x + box.width / 2, y: box.y + box.height * frac };
}

/** Press entry `source`'s handle and move the pointer to `to` (still holding). */
async function pressEntryAndMoveTo(source: number, to: { x: number; y: number }) {
  const title = await entryTitleBox(source);
  // Hover the entry first, as a user would, to reveal its handle.
  await page.mouse.move(title.x + 10, title.y + title.height / 2);
  const handle = await entryHandle(source);
  if (!handle) throw new Error(`no entry drag handle next to entry #${source}`);
  const hb = await boxOf(handle, 'entry handle');
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 6);
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

async function pressEntryAndMove(source: number, target: number, frac: number) {
  await pressEntryAndMoveTo(source, await pointInEntry(target, frac));
}

async function dragEntry(source: number, target: number, frac: number) {
  await pressEntryAndMove(source, target, frac);
  await page.mouse.up();
}

/** Assert the order in the DOM and in the serialized document (everything else unchanged). */
async function expectOrder(titles: string[], ids: string[]) {
  await expect.poll(entryOrder).toEqual(titles);
  const expected = withFirstTimelineOrder(JSON.parse(seed) as Doc, ids);
  await expect.poll(readDoc).toEqual(expected);
}

async function expectUnchanged() {
  await expect.poll(entryOrder).toEqual(INITIAL_ENTRIES);
  await expect.poll(readDoc).toEqual(JSON.parse(seed));
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator(SECTION_HANDLE).first().waitFor({ timeout: 90_000 });
  await setDocument(SEED_DOC);
  await expect(page.locator(TITLE)).toHaveText(INITIAL_TITLES);
  await expect(page.locator(TIMELINE).first().locator(ENTRY_TITLE)).toHaveText(INITIAL_ENTRIES);
  // Let the editor's first onChange settle, then capture the normalized round trip.
  await page.waitForTimeout(300);
  seed = JSON.stringify(await readDoc());
});

test.afterAll(async () => {
  await page.close();
});

test.beforeEach(async () => {
  await page.mouse.up().catch(() => undefined);
  await page.keyboard.press('Escape').catch(() => undefined);
  await setDocument(JSON.parse(seed));
  await expect(page.locator(TITLE)).toHaveText(INITIAL_TITLES);
  await expect(page.locator(TIMELINE).first().locator(ENTRY_TITLE)).toHaveText(INITIAL_ENTRIES);
  // Park the pointer away from the document so no entry starts out hovered.
  await page.mouse.move(2, 2);
});

test.describe('Timeline entry drag handle', () => {
  test('each entry of a multi-entry timeline has a "Drag to reorder entry" handle; a single-entry timeline has none (AC1, AC8)', async () => {
    // Experience has 3 entries → 3 handles; Education has 1 entry → none.
    const handles = page.getByRole('button', { name: 'Drag to reorder entry', exact: true });
    await expect(handles).toHaveCount(3);
    await expect(page.locator(ENTRY_HANDLE)).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(handles.nth(i)).toHaveAttribute('title', 'Drag to reorder');
    }
    for (let i = 0; i < 3; i++) {
      expect(await entryHandle(i), `handle next to entry #${i}`).not.toBeNull();
    }
    // Entry #3 is Omega University, the only entry of the Education timeline.
    expect(await entryHandle(3), 'handle next to the single Education entry').toBeNull();
  });

  test('the handle sits in the left gutter next to the entry title, alongside the ✕ (AC1)', async () => {
    const title = await entryTitleBox(1);
    const titleY = title.y + title.height / 2;
    const handle = await entryHandle(1);
    expect(handle).not.toBeNull();
    const hb = await boxOf(handle!, 'entry handle');
    // In the gutter: entirely left of the title text, vertically centred on it.
    expect(hb.x + hb.width).toBeLessThanOrEqual(title.x + 1);
    expect(Math.abs(hb.y + hb.height / 2 - titleY)).toBeLessThanOrEqual(12);
    // The existing ✕ for the same entry shares the same anchor.
    const removeButtons = page.getByRole('button', { name: 'Remove entry' });
    let removeY: number | null = null;
    for (let i = 0; i < (await removeButtons.count()); i++) {
      const rb = await removeButtons.nth(i).boundingBox();
      if (rb && Math.abs(rb.y + rb.height / 2 - titleY) <= 12) removeY = rb.y + rb.height / 2;
    }
    expect(removeY, 'the ✕ next to the same entry').not.toBeNull();
  });

  test('the handle is hidden until its entry is hovered (AC1)', async () => {
    const handle = await entryHandle(1);
    expect(handle).not.toBeNull();
    await expect(handle!).toHaveCSS('opacity', '0');

    const title = await entryTitleBox(1);
    await page.mouse.move(title.x + 10, title.y + title.height / 2);
    await expect(handle!).toHaveCSS('opacity', '1');

    // Moving away hides it again.
    await page.mouse.move(2, 2);
    await expect(handle!).toHaveCSS('opacity', '0');
  });
});

test.describe('Timeline entry drag-and-drop', () => {
  test('shows a floating drag image of the dragged entry that follows the pointer (AC2)', async () => {
    await pressEntryAndMove(0, 1, 0.8);
    const ghost = page.locator(FLOATING_GHOST);
    await expect(ghost).toBeVisible();
    // The drag image is the entry itself — its title and nested content, not its neighbours.
    await expect(ghost).toContainText('Alpha Corp');
    await expect(ghost).toContainText('Led the migration');
    await expect(ghost).not.toContainText('Beta Inc');
    await expect(ghost).not.toContainText('Experience');

    const before = await boxOf(ghost, 'ghost');
    const p = await pointInEntry(1, 0.8);
    await page.mouse.move(p.x + 40, p.y + 10, { steps: 4 });
    await expect
      .poll(async () => {
        const after = await ghost.boundingBox();
        return after ? [Math.round(after.x - before.x), Math.round(after.y - before.y)] : null;
      })
      .toEqual([40, 10]);
    await page.mouse.up();
  });

  test('shows a drop-indicator line at the boundary where the entry will land (AC2)', async () => {
    // Alpha over the lower half of Beta → it would land between Beta and Gamma.
    await pressEntryAndMove(0, 1, 0.8);
    const line = page.locator(DROP_LINE);
    await expect(line).toBeVisible();
    const lb = await boxOf(line, 'drop line');
    const beta = await boxOf(page.locator(ENTRY).nth(1), 'Beta entry');
    const gamma = await boxOf(page.locator(ENTRY).nth(2), 'Gamma entry');
    const lineY = lb.y + lb.height / 2;
    expect(lineY).toBeGreaterThanOrEqual(beta.y + beta.height - 12);
    expect(lineY).toBeLessThanOrEqual(gamma.y + 12);
    await page.mouse.up();
    // Both clear once dropped.
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(DROP_LINE)).toHaveCount(0);
  });

  test('dropping the first entry on the lower half of the second moves it below the second (AC3, AC7)', async () => {
    await dragEntry(0, 1, 0.8);
    // Fields, description, nested list and chips all travel with their entry; the
    // rest of the serialized document (header, titles, other timeline) is unchanged.
    await expectOrder(['Beta Inc', 'Alpha Corp', 'Gamma LLC'], ['e-beta', 'e-alpha', 'e-gamma']);

    const moved = firstTimeline(await readDoc()).children![1];
    const original = firstTimeline(JSON.parse(seed) as Doc).children![0];
    expect(moved).toEqual(original);
    expect(moved.id).toBe('e-alpha');
    expect(moved.attrs).toEqual({ title: 'Alpha Corp', dates: '2018 – 2020' });

    // The moved entry's DOM carries its own dates/description/list.
    const alpha = page.locator(TIMELINE).first().locator('[data-pb="entry"]').nth(1);
    await expect(alpha.locator('[data-pb="entry-dates"]')).toHaveText('2018 – 2020');
    await expect(alpha).toContainText('Alpha description.');
    await expect(alpha).toContainText('Led the migration');

    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(DROP_LINE)).toHaveCount(0);
  });

  test('the last entry can be dropped at the very top of its timeline (AC4)', async () => {
    await dragEntry(2, 0, 0.1);
    await expectOrder(['Gamma LLC', 'Alpha Corp', 'Beta Inc'], ['e-gamma', 'e-alpha', 'e-beta']);
  });

  test('the first entry can be dropped at the very bottom of its timeline (AC4)', async () => {
    await dragEntry(0, 2, 0.9);
    await expectOrder(['Beta Inc', 'Gamma LLC', 'Alpha Corp'], ['e-beta', 'e-gamma', 'e-alpha']);
  });

  test('the new order persists through a reload of the serialized document (AC7)', async () => {
    await dragEntry(0, 1, 0.8);
    await expectOrder(['Beta Inc', 'Alpha Corp', 'Gamma LLC'], ['e-beta', 'e-alpha', 'e-gamma']);
    // Reload: feed the saved document back in, as the host does after save/reload.
    const saved = await readDoc();
    await setDocument({ header: SEED_DOC.header, body: { type: 'root', id: 'other', children: [] } });
    await setDocument(saved);
    await expect(page.locator(TIMELINE).first().locator(ENTRY_TITLE)).toHaveText([
      'Beta Inc',
      'Alpha Corp',
      'Gamma LLC',
    ]);
  });

  test('dropping an entry onto its own position is a no-op (AC5)', async () => {
    // Over itself.
    await dragEntry(1, 1, 0.5);
    await expectUnchanged();
    // Upper half of the next entry = "before its next sibling" = where it already is.
    await pressEntryAndMove(0, 1, 0.2);
    await expect(page.locator(FLOATING_GHOST)).toBeVisible();
    await expect(page.locator(DROP_LINE)).toHaveCount(0);
    await page.mouse.up();
    await expectUnchanged();
    await expect(page.locator(GHOST)).toHaveCount(0);
  });

  test('dropping an entry outside its timeline is a no-op (AC5)', async () => {
    // Over the single entry of the other (Education) timeline — far outside the source timeline.
    await pressEntryAndMove(0, 3, 0.5);
    await expect(page.locator(FLOATING_GHOST)).toBeVisible();
    await expect(page.locator(DROP_LINE)).toHaveCount(0);
    await page.mouse.up();
    await expectUnchanged();
    // The Education timeline still holds only its own entry.
    await expect(page.locator(TIMELINE).nth(1).locator(ENTRY_TITLE)).toHaveText(['Omega University']);
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(DROP_LINE)).toHaveCount(0);
  });

  test('Escape mid-drag cancels: order unchanged, drag image and indicator cleared (AC5)', async () => {
    await pressEntryAndMove(0, 2, 0.9);
    await expect(page.locator(FLOATING_GHOST)).toBeVisible();
    await expect(page.locator(DROP_LINE)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(DROP_LINE)).toHaveCount(0);

    // The drag is over: moving on and releasing over a valid target does nothing.
    const p = await pointInEntry(2, 0.9);
    await page.mouse.move(p.x, p.y + 2, { steps: 3 });
    await expect(page.locator(GHOST)).toHaveCount(0);
    await page.mouse.up();
    await expectUnchanged();
  });

  test('one undo after a reorder restores the previous order (AC6)', async () => {
    // Focus the editor first, as a user editing the document would be.
    await page.locator(TIMELINE).first().getByText('Gamma description.').click();
    await dragEntry(0, 1, 0.8);
    await expectOrder(['Beta Inc', 'Alpha Corp', 'Gamma LLC'], ['e-beta', 'e-alpha', 'e-gamma']);

    const isMac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
    await expectUnchanged();
  });

  test('undo works right after a drag even when the editor had no focus (AC6)', async () => {
    // Fresh page state: nothing in the editor is focused before the drag.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await dragEntry(0, 1, 0.8);
    await expectOrder(['Beta Inc', 'Alpha Corp', 'Gamma LLC'], ['e-beta', 'e-alpha', 'e-gamma']);

    const isMac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    await page.keyboard.press(isMac ? 'Meta+z' : 'Control+z');
    await expectUnchanged();
  });
});

test.describe('Section drag alongside entry drag', () => {
  async function pressSectionAndMoveTo(source: number, to: { x: number; y: number }) {
    const hb = await boxOf(page.locator(SECTION_HANDLE).nth(source), `section handle #${source}`);
    const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 6);
    await page.mouse.move(to.x, to.y, { steps: 10 });
  }

  /** A point in the lower part of the Education section (its only entry), past the group's midpoint. */
  async function lowerEducationGroup() {
    return pointInEntry(3, 0.9);
  }

  test('dragging a section title still moves the whole section, including its timeline (AC9)', async () => {
    // Experience (0) onto the lower half of the Education group → lands after it.
    await pressSectionAndMoveTo(0, await lowerEducationGroup());
    await page.mouse.up();
    await expect.poll(titleOrder).toEqual(['Education', 'Experience']);

    const body = (await readDoc()).body.children!;
    const ids = body.filter((c) => c.type === 'title' || c.type === 'timeline').map((c) => c.id);
    expect(ids).toEqual(['t-edu', 'tl-edu', 't-exp', 'tl-exp']);
    // The Experience timeline arrives intact, entries in their original order.
    const exp = body.find((c) => c.id === 'tl-exp')!;
    expect(exp).toEqual(firstTimeline(JSON.parse(seed) as Doc));
  });

  test('Escape mid section-drag leaves section order unchanged and removes the drag image', async () => {
    await pressSectionAndMoveTo(0, await lowerEducationGroup());
    await expect(page.locator(GHOST)).toBeVisible();
    await expect(page.locator(DROP_LINE)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(DROP_LINE)).toHaveCount(0);

    await page.mouse.up();
    await expect.poll(titleOrder).toEqual(INITIAL_TITLES);
    await expect.poll(readDoc).toEqual(JSON.parse(seed));
  });
});
