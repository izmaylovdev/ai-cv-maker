import { test, expect, Page } from '@playwright/test';

// Title-group drag-and-drop via the gutter rail (US-EDIT-16 / US-EDIT-19).
//
// Updated from section-based drag to title-group drag: dragging the handle on a
// title node moves the entire group (title + all following non-title blocks) to
// the new position. Uses the same pointer-based drag as before (mousedown →
// mousemove → mouseup), consistent with title-dnd.spec.ts.

const HANDLE = '.pb-rail-handle';
const TITLE = '.pb-content [data-pb="title"]';
const DROP_LINE = '.pb-drop-line';
const GHOST = '.pb-drag-ghost';

const INITIAL = ['Summary', 'Work Experience', 'Education', 'Skills', 'Tools & Languages'];

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
  await expect(page.locator(HANDLE)).toHaveCount(5);
  await expect(page.locator(TITLE)).toHaveText(INITIAL);
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

test.describe('Section drag-and-drop (US-EDIT-16)', () => {
  test('shows a drag preview of the whole dragged section (F-EDIT-16.1)', async () => {
    await pressAndMove(0, 2);
    const ghost = page.locator(GHOST);
    await expect(ghost).toBeVisible();
    await expect(ghost).toContainText('Summary');
    await page.mouse.up();
  });

  test('shows a drop indicator line over the hovered target while dragging (F-EDIT-16.2)', async () => {
    await pressAndMove(0, 2);
    await expect(page.locator(DROP_LINE)).toBeVisible();
    await page.mouse.up();
  });

  test('dropping over the lower half places the section AFTER the target (F-EDIT-16.3)', async () => {
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

  test('dropping over the upper half places the section BEFORE the target (F-EDIT-16.3)', async () => {
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

  test('dragging a section onto itself is a no-op (F-EDIT-16.3)', async () => {
    await pressAndMove(1, 1);
    await page.mouse.up();
    expect(await titleOrder()).toEqual(INITIAL);
  });

  test('only drag handles are present — no move-up/down buttons (F-EDIT-16.3)', async () => {
    expect(await page.locator('[aria-label="Move section up"]').count()).toBe(0);
    expect(await page.locator('[aria-label="Move section down"]').count()).toBe(0);
    expect(await page.locator(HANDLE).count()).toBeGreaterThan(0);
  });
});
