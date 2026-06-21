import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';
import {
  mockOptimizeApi,
  mockOptimizeFailApi,
  mockOptimizeLimitApi,
  mockOptimizeUrlFetchErrorApi,
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
