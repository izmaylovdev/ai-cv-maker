import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';

// US-AI-14 — per-user billing balance page and auth-guarded route.
test.describe('Billing page — per-user balance', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.route('**/api/billing', (route) =>
      route.fulfill({
        json: {
          allowanceUsd: 2.0,
          spentUsd: 0.5,
          balanceUsd: 1.5,
          currency: 'USD',
          promptTokens: 12000,
          completionTokens: 3000,
        },
      }),
    );
  });

  // F-AI-14.8 — Billing nav link is visible and navigates to /billing.
  test('billing link is visible in the navigation and navigates to /billing', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: /billing/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/billing$/);
  });

  // F-AI-14.2 — balance, allowance, and amount spent are shown in USD.
  test('shows balance, allowance, and amount spent in USD', async ({ page }) => {
    await page.goto('/billing');
    await expect(page.getByText('$1.50')).toBeVisible(); // balance
    await expect(page.getByText('$2.00')).toBeVisible(); // allowance
    await expect(page.getByText('$0.50')).toBeVisible(); // spent
  });

  // F-AI-14.7 — token consumption that produced the spend is shown.
  test('shows the prompt and completion token totals', async ({ page }) => {
    await page.goto('/billing');
    await expect(page.getByText('12,000')).toBeVisible();
    await expect(page.getByText('3,000')).toBeVisible();
  });

  // F-AI-14.7 — page renders in dark theme.
  test('renders in dark theme', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/billing');
    await expect(page.locator('html.dark')).toBeVisible();
    // The billing content still renders under the dark class.
    await expect(page.getByText('$1.50')).toBeVisible();
  });
});

// F-AI-14.7 (guard) — /billing is protected by the auth guard.
// This asserts the guard-protected route EXISTS and enforces auth: signed out we land on
// login, and signed in the billing content is reachable. (Signed-out redirect alone can't
// distinguish a real guarded route from the current `**` wildcard fallback, so we also
// assert the authenticated page renders — which fails until BillingComponent + route exist.)
test.describe('Billing page — auth guard', () => {
  test('redirects to login when signed out', async ({ page }) => {
    // No setupAuth: no token in localStorage.
    await page.goto('/billing');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('is reachable at /billing when signed in', async ({ page }) => {
    await setupAuth(page);
    await page.route('**/api/billing', (route) =>
      route.fulfill({
        json: {
          allowanceUsd: 2.0,
          spentUsd: 0.5,
          balanceUsd: 1.5,
          currency: 'USD',
          promptTokens: 12000,
          completionTokens: 3000,
        },
      }),
    );
    await page.goto('/billing');
    // Not bounced to login, and billing content is present (route + component exist).
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByText('$1.50')).toBeVisible();
  });
});
