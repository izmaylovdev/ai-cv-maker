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
