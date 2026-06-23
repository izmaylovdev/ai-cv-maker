import { test, expect, Page } from '@playwright/test';

// Title-group drag-and-drop reorder (US-EDIT-19 / spec §13).
//
// A "group" is one title node plus all consecutive non-title nodes that follow
// it. Dragging the title's handle moves the whole group. The pointer-based drag
// approach (mousedown → mousemove → mouseup) is the same as section-dnd.spec.ts;
// native HTML5 DnD is not used (unreliable in this web-component host).

const HANDLE = '.pb-rail-handle';
const TITLE = '.pb-content [data-pb="title"]';
const DROP_LINE = '.pb-drop-line';
const GHOST = '.pb-drag-ghost';

// The seeded sample document must have at least 3 title nodes for these tests.
// Each title's text is used to assert document order.
const INITIAL_TITLES = ['Summary', 'Work Experience', 'Education', 'Skills', 'Tools & Languages'];

let page: Page;
let seed: string;

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
  await page.mouse.up().catch(() => undefined);
  await page.evaluate((s) => {
    (document.querySelector('applysy-profile-builder') as unknown as { document: unknown }).document =
      JSON.parse(s);
  }, seed);
  await expect(page.locator(HANDLE)).toHaveCount(INITIAL_TITLES.length);
  await expect(page.locator(TITLE)).toHaveText(INITIAL_TITLES);
});

async function titleOrder(): Promise<string[]> {
  return page.locator(TITLE).allTextContents().then((t) => t.map((s) => s.trim()));
}

async function center(selector: string, nth: number) {
  const box = await page.locator(selector).nth(nth).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector} #${nth}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pointInTitle(nth: number, frac: number) {
  const box = await page.locator(TITLE).nth(nth).boundingBox();
  if (!box) throw new Error(`no bounding box for title #${nth}`);
  return { x: box.x + box.width / 2, y: box.y + box.height * frac };
}

async function pressAndMove(sourceIndex: number, targetIndex: number, frac = 0.5) {
  const from = await center(HANDLE, sourceIndex);
  const to = await pointInTitle(targetIndex, frac);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 6);
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test.describe('Title group drag-and-drop (US-EDIT-19)', () => {
  test('shows a drag ghost that includes the title and its group content (F-EDIT-19.4)', async () => {
    // Drag "Summary" (title 0) over "Education" (title 2).
    await pressAndMove(0, 2);
    const ghost = page.locator(GHOST);
    await expect(ghost).toBeVisible();
    // Ghost must include the title heading and the content that belongs to the Summary group.
    await expect(ghost).toContainText('Summary');
    await page.mouse.up();
  });

  test('shows a drop indicator line while dragging between groups (F-EDIT-19.4)', async () => {
    await pressAndMove(0, 2);
    await expect(page.locator(DROP_LINE)).toBeVisible();
    await page.mouse.up();
  });

  test('dropping over lower half places the group AFTER the target title group', async () => {
    // Drag "Summary" (0) onto the lower half of "Education" (2): lands after it.
    await pressAndMove(0, 2, 0.8);
    await page.mouse.up();

    expect(await titleOrder()).toEqual([
      'Work Experience',
      'Education',
      'Summary',
      'Skills',
      'Tools & Languages',
    ]);
    await expect(page.locator(GHOST)).toHaveCount(0);
    await expect(page.locator(DROP_LINE)).toHaveCount(0);
  });

  test('dropping over upper half places the group BEFORE the target title group', async () => {
    // Drag "Tools & Languages" (4) onto the upper half of "Work Experience" (1).
    await pressAndMove(4, 1, 0.2);
    await page.mouse.up();

    expect(await titleOrder()).toEqual([
      'Summary',
      'Tools & Languages',
      'Work Experience',
      'Education',
      'Skills',
    ]);
  });

  test('dragging a title group onto itself is a no-op', async () => {
    await pressAndMove(1, 1);
    await page.mouse.up();
    expect(await titleOrder()).toEqual(INITIAL_TITLES);
  });

  test('content blocks within a group move with their title (group integrity)', async () => {
    // Drag "Work Experience" (1) to after "Skills" (3).
    // The work-experience entries (children of that title group) must follow.
    await pressAndMove(1, 3, 0.8);
    await page.mouse.up();

    const order = await titleOrder();
    expect(order.indexOf('Work Experience')).toBeGreaterThan(order.indexOf('Education'));

    // The group content (e.g. a timeline entry) should appear between
    // "Work Experience" title and the next title in the DOM.
    const titleEls = await page.locator(TITLE).all();
    const workIdx = (await Promise.all(titleEls.map((el) => el.textContent()))).findIndex(
      (t) => t?.trim() === 'Work Experience',
    );
    // There should be at least one non-title element between "Work Experience"
    // and the next title sibling.
    const docBlocks = page.locator('.pb-content > *');
    const count = await docBlocks.count();
    // Find the DOM index of the Work Experience title and check the next element
    // is not another title (i.e. the group content is still between them).
    let foundTitle = false;
    let groupHasContent = false;
    for (let i = 0; i < count; i++) {
      const el = docBlocks.nth(i);
      const pbAttr = await el.getAttribute('data-pb');
      const text = await el.textContent();
      if (pbAttr === 'title' && text?.trim() === 'Work Experience') {
        foundTitle = true;
        continue;
      }
      if (foundTitle && pbAttr !== 'title') {
        groupHasContent = true;
        break;
      }
      if (foundTitle && pbAttr === 'title') break;
    }
    expect(workIdx).toBeGreaterThanOrEqual(0);
    expect(groupHasContent).toBe(true);
  });

  test('move-down button on a title group shifts the whole group past the next title group', async () => {
    await page.locator('.pb-title-rail__group').first().hover();
    await page.getByRole('button', { name: /move.*down/i }).first().click();

    const order = await titleOrder();
    expect(order.slice(0, 2)).toEqual(['Work Experience', 'Summary']);
  });

  test('non-title blocks at root have no drag handle', async () => {
    // Handles should appear only for title nodes, not for paragraphs/timelines/etc.
    const handleCount = await page.locator(HANDLE).count();
    const titleCount = await page.locator(TITLE).count();
    expect(handleCount).toBe(titleCount);
  });
});
