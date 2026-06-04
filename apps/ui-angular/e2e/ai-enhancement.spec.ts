import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';
import { mockEnhanceFieldApi, mockEnhanceFieldFailApi, mockOptimizeApi, mockOptimizeFailApi, mockOptimizeUrlFetchErrorApi, registerFakeChatWidget } from './support/mocks/ai.mock';

const PROFILE_ID = TEST_PROFILE_ID;

// US-AI-1 — Enhance a single text field
test.describe('AI field enhancement', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('enhance button appears when an enhanced-textarea is focused', async ({ page }) => {
    const enhancedTextarea = page.locator('app-enhanced-textarea').first();
    await enhancedTextarea.locator('textarea').click();
    await expect(enhancedTextarea.locator('button[type="button"]')).toBeVisible();
  });

  test('enhance button is disabled when the textarea is empty', async ({ page }) => {
    const enhancedTextarea = page.locator('app-enhanced-textarea').first();
    const textarea = enhancedTextarea.locator('textarea');
    await textarea.fill('');
    await textarea.click();
    const enhanceBtn = enhancedTextarea.locator('button[type="button"]');
    await expect(enhanceBtn).toBeVisible();
    await expect(enhanceBtn).toBeDisabled();
  });

  test('replaces textarea content with AI-enhanced text', async ({ page }) => {
    await mockEnhanceFieldApi(page, PROFILE_ID, 'Enhanced professional summary with strong action verbs.');

    const enhancedTextarea = page.locator('app-enhanced-textarea').first();
    const textarea = enhancedTextarea.locator('textarea');
    await textarea.fill('Original text');
    await textarea.click();

    const enhanceBtn = enhancedTextarea.locator('button[type="button"]');
    await enhanceBtn.click();

    await expect(textarea).toHaveValue('Enhanced professional summary with strong action verbs.');
  });

  test('shows error notification when enhancement API fails', async ({ page }) => {
    await mockEnhanceFieldFailApi(page, PROFILE_ID);

    const enhancedTextarea = page.locator('app-enhanced-textarea').first();
    const textarea = enhancedTextarea.locator('textarea');
    await textarea.fill('Some text to enhance');
    await textarea.click();

    await enhancedTextarea.locator('button[type="button"]').click();
    await expect(page.getByText('Failed to enhance text. Please try again.')).toBeVisible();
  });

  test('original text is preserved when enhancement fails', async ({ page }) => {
    await mockEnhanceFieldFailApi(page, PROFILE_ID);

    const enhancedTextarea = page.locator('app-enhanced-textarea').first();
    const textarea = enhancedTextarea.locator('textarea');
    await textarea.fill('Original unchanged text');
    await textarea.click();

    await enhancedTextarea.locator('button[type="button"]').click();
    await expect(textarea).toHaveValue('Original unchanged text');
  });
});

// US-AI-2 — Full profile optimization
test.describe('AI profile optimization', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('opens optimize dialog when clicking Optimize with AI', async ({ page }) => {
    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await expect(page.getByRole('heading', { name: 'Optimize with AI' })).toBeVisible();
    await expect(page.getByPlaceholder(/Senior React developer/)).toBeVisible();
  });

  test('Apply button is disabled when the target role input is empty', async ({ page }) => {
    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  test('Apply button enables after typing a target role', async ({ page }) => {
    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Senior TypeScript engineer at fintech');
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  test('updates profile title and overview after optimization', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Senior TypeScript engineer at fintech');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByPlaceholder('Senior Software Engineer')).toHaveValue('Senior TypeScript Engineer');
  });

  test('updates skills list after optimization', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Senior TypeScript engineer at fintech');
    await page.getByRole('button', { name: 'Apply' }).click();

    const skillInputs = page.getByPlaceholder('Skill');
    await expect(skillInputs.nth(2)).toHaveValue('Kubernetes');
  });

  test('shows success notification after optimization', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Senior TypeScript engineer');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText(/Profile optimized/)).toBeVisible();
  });

  test('shows error notification when optimization API fails', async ({ page }) => {
    await mockOptimizeFailApi(page, PROFILE_ID);

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Some target role');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('Failed to optimize profile. Please try again.')).toBeVisible();
  });

  // US-AI-3 — Cancel optimization / discard suggestions
  test('closes dialog without changing profile when Cancel is clicked', async ({ page }) => {
    const titleInput = page.getByPlaceholder('Senior Software Engineer');
    const originalTitle = await titleInput.inputValue();

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Some target role');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: 'Optimize with AI' })).not.toBeVisible();
    await expect(titleInput).toHaveValue(originalTitle);
  });

  test('profile title is unchanged when optimize dialog is dismissed via Cancel', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);
    const titleInput = page.getByPlaceholder('Senior Software Engineer');
    const originalTitle = await titleInput.inputValue();

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(titleInput).toHaveValue(originalTitle);
  });
});

// US-AI-5 — Job posting URL optimization
test.describe('AI optimization with job posting URL', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('accepts a job posting URL in the target role field', async ({ page }) => {
    await mockOptimizeApi(page, PROFILE_ID);

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('https://jobs.example.com/senior-engineer-123');
    await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  test('shows API error message in the dialog when the job posting URL cannot be fetched', async ({ page }) => {
    await mockOptimizeUrlFetchErrorApi(
      page,
      PROFILE_ID,
      'Could not reach the job posting URL. Please check the link or paste the job description manually.',
    );

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('https://unreachable.example.com/job');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(
      page.getByText('Could not reach the job posting URL. Please check the link or paste the job description manually.'),
    ).toBeVisible();
  });

  test('dialog stays open after a URL fetch error so the user can correct input', async ({ page }) => {
    await mockOptimizeUrlFetchErrorApi(page, PROFILE_ID, 'Could not reach the job posting URL.');

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('https://unreachable.example.com/job');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByRole('heading', { name: 'Optimize with AI' })).toBeVisible();
  });

  test('profile is unchanged after a URL fetch error', async ({ page }) => {
    await mockOptimizeUrlFetchErrorApi(page, PROFILE_ID, 'Could not reach the job posting URL.');
    const titleInput = page.getByPlaceholder('Senior Software Engineer');
    const originalTitle = await titleInput.inputValue();

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('https://unreachable.example.com/job');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(titleInput).toHaveValue(originalTitle);
  });
});

// US-AI-2 — Rate limiting / service error
test.describe('AI optimization error handling', () => {
  test('shows error when AI service returns 503', async ({ page }) => {
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);

    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}/optimize`, (route) =>
      route.fulfill({ status: 503, body: 'AI quota exceeded' })
    );

    await page.getByRole('button', { name: /Optimize with AI/ }).click();
    await page.getByPlaceholder(/Senior React developer/).fill('Target role');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByText('Failed to optimize profile. Please try again.')).toBeVisible();
  });
});

// US-AI-4 — Conversational profile chat (web component)
test.describe('Chat widget', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeChatWidget(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  const chatLink = (page: import('@playwright/test').Page) =>
    page.getByRole('button', { name: /Chat/i }).or(page.getByRole('link', { name: /Chat/i }));

  test('shows Chat button on the profile page', async ({ page }) => {
    await expect(chatLink(page)).toBeVisible();
  });

  test('opens chat page containing the widget when Chat link is clicked', async ({ page }) => {
    await chatLink(page).click();
    await expect(page.locator('ai-chat-widget')).toBeVisible();
  });

  test('passes auth-token attribute to the widget', async ({ page }) => {
    const { FAKE_TOKEN } = await import('./support/auth');
    await chatLink(page).click();
    await expect(page.locator('ai-chat-widget')).toHaveAttribute('auth-token', FAKE_TOKEN);
  });
});
