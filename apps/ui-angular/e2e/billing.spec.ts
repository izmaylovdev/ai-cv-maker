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

// ---------------------------------------------------------------------------
// US-BILL-1 — Top up AI credit with region-aware payment channels.
// UI-contract tests against a mocked /api/billing* backend: they assert what
// the Angular billing feature calls and shows, not the real providers.
// ---------------------------------------------------------------------------
test.describe('Billing top-up — US-BILL-1', () => {
  type TopUpRow = {
    id: string;
    amountUsd: number;
    channel: string;
    status: 'Pending' | 'Paid' | 'Failed';
    createdAt: string;
  };

  /**
   * Mocks the billing API and returns capture arrays for requests the UI makes.
   * `country` drives whether the country picker step should appear.
   */
  async function mockBillingApi(
    page: import('@playwright/test').Page,
    opts: { country: string | null; topUps?: TopUpRow[] },
  ) {
    const countryPuts: Array<{ country: string }> = [];
    const topUpPosts: Array<{ amountUsd: number }> = [];
    let currentCountry = opts.country;

    await page.route('**/api/billing', (route) =>
      route.fulfill({
        json: {
          allowanceUsd: 2.0,
          spentUsd: 0.5,
          balanceUsd: 1.5,
          currency: 'USD',
          promptTokens: 12000,
          completionTokens: 3000,
          country: currentCountry,
        },
      }),
    );

    await page.route('**/api/billing/top-ups', (route) =>
      route.fulfill({ json: opts.topUps ?? [] }),
    );

    await page.route('**/api/billing/country', (route) => {
      const body = route.request().postDataJSON() as { country: string };
      countryPuts.push(body);
      currentCountry = body.country;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.route('**/api/billing/top-up', (route) => {
      const body = route.request().postDataJSON() as { amountUsd: number };
      topUpPosts.push(body);
      return route.fulfill({
        json: {
          paymentId: 'pay-123',
          channel: currentCountry === 'UA' ? 'monobank' : 'stripe',
          redirectUrl: 'http://localhost:4200/e2e-fake-provider/pay-123',
        },
      });
    });

    // Local stand-in for the external provider page the API redirects to.
    await page.route('**/e2e-fake-provider/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Provider payment page</h1>' }),
    );

    return { countryPuts, topUpPosts };
  }

  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
  });

  // AC1 — the Billing page offers a Top up action with fixed amounts.
  test('offers top-up amounts of $5, $10 and $20', async ({ page }) => {
    await mockBillingApi(page, { country: 'DE' });
    await page.goto('/billing');

    await expect(page.getByRole('button', { name: /\$5\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /\$10\b/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /\$20\b/ })).toBeVisible();
  });

  // AC2 — first top-up with no saved country asks for the country and saves it.
  test('asks me to pick a country on first top-up and saves it to my account', async ({ page }) => {
    const { countryPuts, topUpPosts } = await mockBillingApi(page, { country: null });
    await page.goto('/billing');

    await page.getByRole('button', { name: /\$10\b/ }).click();

    // The top-up is NOT started yet — the country step comes first.
    expect(topUpPosts).toHaveLength(0);
    const search = page.getByPlaceholder(/country/i);
    await expect(search).toBeVisible();

    await search.fill('Ukra');
    await page.getByText('Ukraine').click();
    await page.getByRole('button', { name: /confirm|continue|save/i }).click();

    // Country is persisted as ISO alpha-2, then the top-up proceeds.
    await expect.poll(() => countryPuts.length).toBeGreaterThan(0);
    expect(countryPuts[0]).toEqual({ country: 'UA' });
    await expect.poll(() => topUpPosts.length).toBeGreaterThan(0);
    expect(topUpPosts[0]).toEqual({ amountUsd: 10 });
  });

  // AC2 — a saved country is never asked for again.
  test('does not ask for a country again when one is already saved', async ({ page }) => {
    const { countryPuts, topUpPosts } = await mockBillingApi(page, { country: 'UA' });
    await page.goto('/billing');

    await page.getByRole('button', { name: /\$10\b/ }).click();

    // Straight to the payment: top-up requested, no country picker, no country PUT.
    await expect.poll(() => topUpPosts.length).toBeGreaterThan(0);
    expect(topUpPosts[0]).toEqual({ amountUsd: 10 });
    expect(countryPuts).toHaveLength(0);
    await expect(page.getByPlaceholder(/country/i)).toHaveCount(0);
  });

  // AC3 — the saved country is visible on the Billing page and editable.
  test('shows my saved payment country and lets me change it', async ({ page }) => {
    const { countryPuts } = await mockBillingApi(page, { country: 'DE' });
    await page.goto('/billing');

    // The saved country is shown on a "Payment country" row.
    await expect(page.getByText(/payment country/i)).toBeVisible();
    await expect(page.getByText(/Germany/)).toBeVisible();

    // Change it to Ukraine before any payment.
    await page.getByRole('button', { name: /change|edit/i }).click();
    const search = page.getByPlaceholder(/country/i);
    await search.fill('Ukra');
    await page.getByText('Ukraine').click();
    await page.getByRole('button', { name: /confirm|continue|save/i }).click();

    await expect.poll(() => countryPuts.length).toBeGreaterThan(0);
    expect(countryPuts[0]).toEqual({ country: 'UA' });
  });

  // AC4 — starting a top-up posts the amount and navigates to the provider redirect URL.
  test('starts a top-up and navigates to the payment page returned by the API', async ({ page }) => {
    const { topUpPosts } = await mockBillingApi(page, { country: 'UA' });
    await page.goto('/billing');

    await page.getByRole('button', { name: /\$20\b/ }).click();

    await page.waitForURL(/e2e-fake-provider\/pay-123/);
    expect(topUpPosts).toEqual([{ amountUsd: 20 }]);
    await expect(page.getByText('Provider payment page')).toBeVisible();
  });

  // AC7 — top-up history: date, amount, channel and status, newest first.
  test('lists my top-up history newest first with date, amount, channel and status', async ({ page }) => {
    await mockBillingApi(page, {
      country: 'UA',
      topUps: [
        { id: 't3', amountUsd: 5, channel: 'monobank', status: 'Pending', createdAt: '2026-07-05T10:00:00Z' },
        { id: 't2', amountUsd: 10, channel: 'stripe', status: 'Paid', createdAt: '2026-07-04T09:00:00Z' },
        { id: 't1', amountUsd: 20, channel: 'stripe', status: 'Failed', createdAt: '2026-07-01T08:00:00Z' },
      ],
    });
    await page.goto('/billing');

    const rows = page.getByRole('row').filter({ hasText: /pending|paid|failed/i });
    await expect(rows).toHaveCount(3);

    // Newest first, each with date, amount, channel and status.
    await expect(rows.nth(0)).toContainText(/\$5\b/);
    await expect(rows.nth(0)).toContainText(/monobank/i);
    await expect(rows.nth(0)).toContainText(/pending/i);
    await expect(rows.nth(0)).toContainText(/2026/);

    await expect(rows.nth(1)).toContainText(/\$10\b/);
    await expect(rows.nth(1)).toContainText(/stripe/i);
    await expect(rows.nth(1)).toContainText(/paid/i);

    await expect(rows.nth(2)).toContainText(/\$20\b/);
    await expect(rows.nth(2)).toContainText(/stripe/i);
    await expect(rows.nth(2)).toContainText(/failed/i);
  });

  // AC5 — returning with ?topup&outcome=success shows a success banner and strips the params.
  test('shows a success banner after returning from a successful payment', async ({ page }) => {
    await mockBillingApi(page, { country: 'UA' });
    await page.goto('/billing?topup=pay-123&outcome=success');

    await expect(page.getByText(/success/i).first()).toBeVisible();
    // Query params are stripped once handled.
    await expect(page).not.toHaveURL(/topup=/);
  });

  // AC6 — a cancelled payment shows a "didn't complete" banner and changes nothing.
  test("shows a payment didn't complete banner after a cancelled payment", async ({ page }) => {
    await mockBillingApi(page, { country: 'UA' });
    await page.goto('/billing?topup=pay-123&outcome=cancelled');

    await expect(page.getByText(/didn.t complete/i)).toBeVisible();
    // Balance and allowance are untouched.
    await expect(page.getByText('$1.50')).toBeVisible();
    await expect(page.getByText('$2.00')).toBeVisible();
    await expect(page).not.toHaveURL(/topup=/);
  });

  // AC6 — a failed payment shows the same "didn't complete" messaging.
  test("shows a payment didn't complete banner after a failed payment", async ({ page }) => {
    await mockBillingApi(page, { country: 'UA' });
    await page.goto('/billing?topup=pay-123&outcome=failure');

    await expect(page.getByText(/didn.t complete/i)).toBeVisible();
  });

  // AC10 — the top-up UI renders in the light theme.
  test('renders the top-up UI in light theme', async ({ page }) => {
    await mockBillingApi(page, { country: 'DE' });
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
    await page.goto('/billing');

    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: /\$10\b/ })).toBeVisible();
    await expect(page.getByText(/payment country/i)).toBeVisible();
  });

  // AC10 — the top-up UI renders in the dark theme.
  test('renders the top-up UI in dark theme', async ({ page }) => {
    await mockBillingApi(page, { country: 'DE' });
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await page.goto('/billing');

    await expect(page.locator('html.dark')).toBeVisible();
    await expect(page.getByRole('button', { name: /\$10\b/ })).toBeVisible();
    await expect(page.getByText(/payment country/i)).toBeVisible();
  });
});
