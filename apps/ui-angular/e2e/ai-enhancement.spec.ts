import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';
import {
  mockChatEditApi,
  registerFakeChatWidget,
} from './support/mocks/ai.mock';
import { registerFakeProfileBuilder } from './support/mocks/builder.mock';

const PROFILE_ID = TEST_PROFILE_ID;

// US-AI-10 — the in-editor chat lives in a slide-in sidebar that defaults closed.
// Open it via the "AI Editor" toggle before asserting on the widget.
const aiToggle = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /AI Editor/i }).first();

async function openChat(page: import('@playwright/test').Page) {
  await aiToggle(page).click();
  await expect(page.locator('app-profile ai-chat-widget')).toBeVisible();
}

// US-AI-15 — drag the resize handle. `dragTo` is unsuitable here because the
// handle moves as the panel resizes (Playwright never sees it "stable" at the
// release point); use raw mouse events instead. The component listens for
// `pointermove` on `document`, so the pointer need not stay over the handle.
// Positive `widenByPx` widens the panel (drag left → wider); negative narrows.
async function dragHandleBy(page: import('@playwright/test').Page, widenByPx: number) {
  const handle = page.locator('aside [role="separator"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error('resize handle is not visible');
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - widenByPx, y, { steps: 10 });
  await page.mouse.up();
}

// US-AI-4 — Conversational profile chat (web component on the /chat page).
test.describe('Chat widget', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeChatWidget(page);
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  const chatLink = (page: import('@playwright/test').Page) =>
    page.getByRole('link', { name: /AI Assistant/i }).or(page.getByRole('button', { name: /AI Assistant/i }));

  test('opens the chat page containing the widget when the AI Assistant link is clicked', async ({ page }) => {
    await chatLink(page).first().click();
    await expect(page.locator('ai-chat-widget')).toBeVisible();
  });

  test('passes the auth-token attribute to the widget', async ({ page }) => {
    const { FAKE_TOKEN } = await import('./support/auth');
    await chatLink(page).first().click();
    await expect(page.locator('ai-chat-widget')).toHaveAttribute('auth-token', FAKE_TOKEN);
  });
});

// US-AI-9 — Edit the open profile via the in-editor chat.
// The profile editor hosts an <ai-chat-widget> scoped to the open document. When
// the assistant returns an edit, the host applies it live to the builder (unsaved)
// and never persists until the user clicks Save.
test.describe('In-editor chat editing', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeChatWidget(page);
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await mockChatEditApi(page, 'Done.');
    await page.goto(`/job-profiles/${PROFILE_ID}`);
    // The chat now lives in a collapsible sidebar (US-AI-10); open it first.
    await openChat(page);
  });

  test('the editor page embeds a chat widget scoped to the open profile', async ({ page }) => {
    await expect(page.locator('app-profile ai-chat-widget')).toBeVisible();
    // The host syncs the open document onto the widget as context.
    await expect(page.locator('app-profile ai-chat-widget')).toHaveAttribute(
      'data-has-document',
      'true',
    );
  });

  test('applies a chat edit live to the builder without auto-saving', async ({ page }) => {
    const widget = page.locator('app-profile ai-chat-widget');
    await expect(widget).toBeVisible();

    let putCalled = false;
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}`, (route) => {
      if (route.request().method() === 'PUT') putCalled = true;
      route.fulfill({ json: {} });
    });

    // Assistant returns an edit changing the header title.
    await widget.evaluate((el: HTMLElement & { __emitEdit(p: string, d?: string): void }) =>
      el.__emitEdit(
        JSON.stringify({ ops: [{ op: 'updateHeader', fields: { title: 'Staff Engineer' } }] }),
        'Change title to Staff Engineer',
      ),
    );

    // Live in the builder…
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute(
      'data-title',
      'Staff Engineer',
    );
    // …but nothing persisted automatically.
    expect(putCalled).toBe(false);
  });

  test('persists the chat edit only after the user saves', async ({ page }) => {
    const widget = page.locator('app-profile ai-chat-widget');
    await expect(widget).toBeVisible();

    let savedTitle: string | undefined;
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}`, (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { document?: { header?: { title?: string } } };
        savedTitle = body.document?.header?.title;
      }
      route.fulfill({ json: {} });
    });

    await widget.evaluate((el: HTMLElement & { __emitEdit(p: string, d?: string): void }) =>
      el.__emitEdit(
        JSON.stringify({ ops: [{ op: 'updateHeader', fields: { title: 'Staff Engineer' } }] }),
      ),
    );
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute('data-title', 'Staff Engineer');

    await page.getByRole('button', { name: /Save Profile/i }).click();
    await expect.poll(() => savedTitle).toBe('Staff Engineer');
  });

  test('reports a rejected edit in the chat and leaves the document unchanged', async ({ page }) => {
    const widget = page.locator('app-profile ai-chat-widget');
    await expect(widget).toBeVisible();

    // A patch targeting a non-existent node is rejected atomically.
    await widget.evaluate((el: HTMLElement & { __emitEdit(p: string, d?: string): void }) =>
      el.__emitEdit(JSON.stringify({ ops: [{ op: 'removeNode', id: 'MISSING' }] })),
    );

    // The builder title is untouched…
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute(
      'data-title',
      'Software Engineer',
    );
    // …and the host surfaced a note back into the chat thread.
    await expect(widget).toHaveAttribute('data-last-note', /.+/);
  });
});

// US-AI-10 — Collapsible slide-in AI chat sidebar.
// The in-editor chat (US-AI-9) is hosted in a panel that slides in from the
// right and can be hidden back. Closing only hides it — the widget stays
// mounted so the conversation and live document binding survive.
test.describe('Collapsible AI chat sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeChatWidget(page);
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await mockChatEditApi(page, 'Done.');
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('the chat panel is hidden by default', async ({ page }) => {
    await expect(aiToggle(page)).toBeVisible();
    await expect(page.locator('app-profile ai-chat-widget')).toBeHidden();
    await expect(aiToggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('the toggle opens the panel and reflects the open state', async ({ page }) => {
    await aiToggle(page).click();
    await expect(page.locator('app-profile ai-chat-widget')).toBeVisible();
    await expect(aiToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('the in-panel close button hides the panel again', async ({ page }) => {
    await openChat(page);
    await page.getByRole('button', { name: /Close AI editor/i }).click();
    await expect(page.locator('app-profile ai-chat-widget')).toBeHidden();
    await expect(aiToggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('pressing Escape closes the open panel', async ({ page }) => {
    await openChat(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('app-profile ai-chat-widget')).toBeHidden();
  });

  test('closing keeps the widget mounted (thread and document context survive)', async ({ page }) => {
    await openChat(page);
    const widget = page.locator('app-profile ai-chat-widget');
    // Mark the live element via a host-surfaced note, then close + reopen.
    await widget.evaluate((el: HTMLElement & { addAssistantNote(t: string): void }) =>
      el.addAssistantNote('remembered'),
    );
    await page.keyboard.press('Escape');
    await expect(widget).toBeHidden();
    await openChat(page);
    // Same element instance — never re-created — so the note (and its thread) persists.
    await expect(widget).toHaveAttribute('data-last-note', 'remembered');
    await expect(widget).toHaveAttribute('data-has-document', 'true');
  });

  test('remembers the open state across a reload', async ({ page }) => {
    await openChat(page);
    await page.reload();
    await registerFakeChatWidget(page); // re-arm (addInitScript ran on first load)
    await expect(page.locator('app-profile ai-chat-widget')).toBeVisible();
    await expect(aiToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });
});

// US-AI-15 — Resizable AI chat sidebar.
// The open chat panel shows a drag handle that allows resizing its width,
// persisted to localStorage, within a sensible clamped range, accessible
// from keyboard, and responsive to screen size.
test.describe('US-AI-15: Resizable Chat Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeChatWidget(page);
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await mockChatEditApi(page, 'Done.');
    // Set viewport to lg+ breakpoint (1024px) for most tests
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`/job-profiles/${PROFILE_ID}`);
    await openChat(page);
  });

  test('F-AI-15.1: shows a drag handle on the chat panel left edge with ew-resize cursor on lg+ screens', async ({
    page,
  }) => {
    const handle = page.locator('aside [role="separator"]');
    // Handle should be visible on lg+
    await expect(handle).toBeVisible();
    // Cursor should change to ew-resize on hover
    await handle.hover();
    await expect(handle).toHaveCSS('cursor', 'ew-resize');
  });

  test('F-AI-15.2: dragging handle left widens the panel and dragging right narrows it', async ({ page }) => {
    const aside = page.locator('app-profile aside');

    // Get initial width (default 384px)
    const initialWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(initialWidth).toBe(384);

    // Drag right to narrow the panel
    await dragHandleBy(page, -50);
    const narrowedWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(narrowedWidth).toBeLessThan(initialWidth);

    // Drag left to widen the panel back beyond the narrowed width
    await dragHandleBy(page, 80);
    const widenedWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(widenedWidth).toBeGreaterThan(narrowedWidth);
  });

  test('F-AI-15.3: width is clamped to [320px, min(720px, 66% of viewport)]', async ({ page }) => {
    const aside = page.locator('app-profile aside');

    // Get viewport width
    const viewportSize = page.viewportSize();
    const maxWidth = Math.min(720, Math.ceil(viewportSize!.width * 0.66));

    // Try to narrow far past the minimum 320px
    await dragHandleBy(page, -1000);
    let width = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(width).toBe(320);

    // Try to widen far past the maximum
    await dragHandleBy(page, 2000);
    width = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(width).toBe(maxWidth);
  });

  test('F-AI-15.4: on lg+, document column margin equals current panel width (no gap, no overlap)', async ({
    page,
  }) => {
    const editor = page.locator('app-profile div.transition-\\[margin\\]');
    const aside = page.locator('app-profile aside');

    // Wait for the open/margin CSS transition (300ms) to fully settle.
    await page.waitForTimeout(450);

    // Check that right margin matches panel width
    let panelWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    let editorMargin = await editor.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const margin = style.marginRight;
      return parseFloat(margin);
    });

    // Initial state: should have mr-96 (384px) when chat is open on lg+
    expect(editorMargin).toBe(384);

    // Drag to resize and verify margin updates
    await dragHandleBy(page, -50);
    await page.waitForTimeout(450);

    panelWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    editorMargin = await editor.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const margin = style.marginRight;
      return parseFloat(margin);
    });

    // Margin should update to match new panel width
    expect(Math.abs(editorMargin - panelWidth)).toBeLessThan(5); // Allow small rounding
  });

  test('F-AI-15.5: width is persisted to localStorage and restored on load', async ({ page }) => {
    const aside = page.locator('app-profile aside');

    // Resize to a specific width
    await dragHandleBy(page, -50);
    const resizedWidth = await aside.boundingBox().then((box) => box?.width ?? 0);

    // Verify it was stored in localStorage
    const storedWidth = await page.evaluate(() => localStorage.getItem('applysy.profile.chatWidth'));
    expect(storedWidth).toBeTruthy();
    expect(parseInt(storedWidth!)).toBeCloseTo(resizedWidth, 5);

    // Reload and verify width is restored
    await page.reload();
    await registerFakeChatWidget(page);
    await page.waitForTimeout(100);

    const restoredWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(restoredWidth).toBeCloseTo(resizedWidth, 5);
  });

  test('F-AI-15.6: resizing does not remount chat, reset conversation, or drop document binding', async ({
    page,
  }) => {
    const widget = page.locator('app-profile ai-chat-widget');

    // Mark the element with a note so we can detect if it's remounted
    await widget.evaluate((el: HTMLElement & { addAssistantNote(t: string): void }) =>
      el.addAssistantNote('test-note'),
    );
    const initialNote = await widget.getAttribute('data-last-note');

    // Resize the panel
    await dragHandleBy(page, -50);
    await page.waitForTimeout(100);

    // Widget should still have the same note (not remounted, conversation survives)
    const noteAfterResize = await widget.getAttribute('data-last-note');
    expect(noteAfterResize).toBe(initialNote);

    // Document binding should still be active
    await expect(widget).toHaveAttribute('data-has-document', 'true');
  });

  test('F-AI-15.7: below lg, no resize handle is shown', async ({ page }) => {
    // Switch to md breakpoint (768px - below lg)
    await page.setViewportSize({ width: 768, height: 768 });
    await page.reload();
    await registerFakeChatWidget(page);
    await openChat(page);

    const handle = page.locator('aside [role="separator"]');
    await expect(handle).not.toBeVisible();
  });

  test('F-AI-15.8: handle is keyboard-accessible with ArrowLeft/ArrowRight', async ({ page }) => {
    const handle = page.locator('aside [role="separator"]');
    const aside = page.locator('app-profile aside');

    // Handle should be focusable
    await handle.focus();
    await expect(handle).toBeFocused();

    // Handle should have accessible name
    await expect(handle).toHaveAttribute('aria-label', /Resize|resize|AI|panel/i);

    // Get initial width
    const initialWidth = await aside.boundingBox().then((box) => box?.width ?? 0);

    // Press ArrowRight to narrow
    await handle.press('ArrowRight');
    await page.waitForTimeout(100);
    let newWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(newWidth).toBeLessThan(initialWidth);

    // Press ArrowLeft to widen
    await handle.press('ArrowLeft');
    await page.waitForTimeout(100);
    newWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(newWidth).toBeGreaterThan(initialWidth - 5); // Allow for rounding
  });

  test('F-AI-15.9: works in light and dark themes', async ({ page }) => {
    const aside = page.locator('app-profile aside');

    // Resize wider in light theme
    await dragHandleBy(page, 60);
    const lightResized = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(lightResized).toBeGreaterThan(384);

    // Switch to dark theme
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(100);

    // Resize (narrower) should still work in dark theme
    await dragHandleBy(page, -40);
    await page.waitForTimeout(100);
    const darkWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(darkWidth).toBeLessThan(lightResized);

    // Switch back to light theme and verify resize still works
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });
    await page.waitForTimeout(100);
    await dragHandleBy(page, 30);
    await page.waitForTimeout(100);
    const finalWidth = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(finalWidth).toBeGreaterThan(darkWidth);
  });

  test('clamping is re-evaluated on window resize so panel never exceeds viewport', async ({ page }) => {
    const aside = page.locator('app-profile aside');

    // Widen the viewport (still lg): at 1280px max = min(720, ceil(66% of 1280)) = 720px.
    await page.setViewportSize({ width: 1280, height: 768 });
    await page.waitForTimeout(100);

    // Drag wide — clamped to the 720px max.
    await dragHandleBy(page, 2000);
    let width = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(width).toBe(720);

    // Shrink the viewport but stay on lg (>=1024): at 1024px max = 676px.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(200);

    // The window:resize handler re-clamps the stored width down to the new max.
    width = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(width).toBe(676);
  });

  test('resizing updates the panel live during drag (not only on mouse-up)', async ({ page }) => {
    const aside = page.locator('app-profile aside');
    const handle = page.locator('aside [role="separator"]');

    const initialWidth = await aside.boundingBox().then((box) => box?.width ?? 0);

    // Grab the handle at its real position, then drag left in steps, sampling
    // the width mid-drag to prove it tracks the pointer (not just on release).
    const box = await handle.boundingBox();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();

    const widths: number[] = [];
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(startX - i * 15, y);
      await page.waitForTimeout(30);
      widths.push(await aside.boundingBox().then((b) => b?.width ?? 0));
    }
    await page.mouse.up();

    // Dragging left widens, so the sampled widths grow past the initial width.
    expect(widths[0]).toBeGreaterThan(initialWidth);
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0]);
  });

  test('default width when no localStorage value is 384px (matching fixed width from US-AI-10)', async ({
    page,
  }) => {
    // Clear localStorage to reset to default
    await page.evaluate(() => localStorage.removeItem('applysy.profile.chatWidth'));

    await page.reload();
    await registerFakeChatWidget(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await openChat(page);

    const aside = page.locator('app-profile aside');
    await page.waitForTimeout(100);

    const width = await aside.boundingBox().then((box) => box?.width ?? 0);
    expect(width).toBe(384);
  });
});
