import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';
import {
  mockOptimizeApi,
  mockOptimizeFailApi,
  mockOptimizeLimitApi,
  mockOptimizeUrlFetchErrorApi,
  mockChatEditApi,
  registerFakeChatWidget,
} from './support/mocks/ai.mock';
import { registerFakeProfileBuilder } from './support/mocks/builder.mock';

const LIMIT_MESSAGE = "You've reached your AI usage limit of $0.50.";

const PROFILE_ID = TEST_PROFILE_ID;

// US-AI-2 — Full profile optimization (document model, ADR-0013).
// The profile page asks for a target role via a prompt, calls /optimize, and
// loads the returned ProfileDocument into the builder for review (no auto-save).
test.describe('AI profile optimization', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('does not call optimize when the prompt is cancelled', async ({ page }) => {
    let optimizeCalled = false;
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}/optimize`, (route) => {
      optimizeCalled = true;
      route.fulfill({ json: { document: { header: {}, sections: [] } } });
    });
    page.on('dialog', (dialog) => dialog.dismiss());

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    // Give the (dismissed) prompt a moment; optimize must not be called.
    await page.waitForTimeout(200);
    expect(optimizeCalled).toBe(false);
  });

  test('loads the optimized document into the builder and notifies', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);
    page.on('dialog', (dialog) => dialog.accept('Senior TypeScript engineer at fintech'));

    await page.getByRole('button', { name: /Optimize with AI/ }).click();

    await expect(page.getByText(/Profile optimized/)).toBeVisible();
    // The builder reflects the optimized header (title rewritten).
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute(
      'data-title',
      'Senior TypeScript Engineer',
    );
  });

  test('accepts a job posting URL as the optimization goal', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);
    let captured: Record<string, unknown> = {};
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}/optimize`, (route) => {
      captured = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ json: { document: { header: { fullName: 'Jane Doe', title: 'X' }, sections: [] } } });
    });
    page.on('dialog', (dialog) => dialog.accept('https://jobs.example.com/senior-engineer-123'));

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await expect(page.getByText(/Profile optimized/)).toBeVisible();
    expect(captured['message']).toBe('https://jobs.example.com/senior-engineer-123');
  });

  test('shows an error notification when optimization fails', async ({ page }) => {
    await mockOptimizeFailApi(page, PROFILE_ID);
    page.on('dialog', (dialog) => dialog.accept('Some target role'));

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await expect(page.getByText('Failed to optimize profile. Please try again.')).toBeVisible();
  });

  test('shows the API error message when the job posting URL cannot be fetched', async ({ page }) => {
    await mockOptimizeUrlFetchErrorApi(
      page,
      PROFILE_ID,
      'Could not reach the job posting URL. Please check the link or paste the job description manually.',
    );
    page.on('dialog', (dialog) => dialog.accept('https://unreachable.example.com/job'));

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await expect(
      page.getByText('Could not reach the job posting URL. Please check the link or paste the job description manually.'),
    ).toBeVisible();
  });

  // US-AI-7 — spending limit
  test('shows the distinct spending-limit message when blocked (402)', async ({ page }) => {
    await mockOptimizeLimitApi(page, PROFILE_ID, LIMIT_MESSAGE);
    page.on('dialog', (dialog) => dialog.accept('Some target role'));

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await expect(page.getByText(LIMIT_MESSAGE)).toBeVisible();
    await expect(page.getByText('Failed to optimize profile. Please try again.')).toHaveCount(0);
  });
});

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
