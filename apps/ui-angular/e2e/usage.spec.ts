import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';

// US-AI-7 — usage page shows the spending limit and remaining budget
test.describe('Usage page — spending limit', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.route('**/api/usage', (route) =>
      route.fulfill({
        json: {
          promptTokens: 12000,
          completionTokens: 3000,
          estimatedCostUsd: 0.12,
          limitUsd: 0.5,
        },
      }),
    );
    await page.goto('/usage');
  });

  test('shows the spending limit', async ({ page }) => {
    await expect(page.getByText('$0.50')).toBeVisible();
  });

  test('shows the remaining budget (limit − accrued)', async ({ page }) => {
    // 0.50 − 0.12 = 0.38 remaining
    await expect(page.getByText('$0.38')).toBeVisible();
  });
});
