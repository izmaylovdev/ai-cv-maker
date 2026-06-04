import { test, expect, Page } from '@playwright/test';

const MOCK_TOKEN = 'mock-jwt-token-for-e2e';

const MOCK_USERS = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    email: 'alice@example.com',
    googleId: null,
    createdAt: '2024-01-15T10:00:00.000Z',
    profileCount: 3,
  },
  {
    id: 'bbbbbbbb-0000-0000-0000-000000000002',
    email: 'bob@example.com',
    googleId: 'google-id-bob',
    createdAt: '2024-02-20T12:00:00.000Z',
    profileCount: 1,
  },
];

async function authenticateContext(page: Page) {
  await page.context().addCookies([
    { name: 'admin_authed', value: '1', domain: 'localhost', path: '/' },
  ]);
  await page.addInitScript((token) => {
    localStorage.setItem('admin_token', token);
  }, MOCK_TOKEN);
}

test.describe('Login page', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.locator('form').getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows an error on invalid credentials', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      })
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('shows access denied for a non-admin account', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Forbidden' }),
      })
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('password');
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Access denied: not an authorized admin.')).toBeVisible();
  });

  test('redirects to dashboard on successful login', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accessToken: MOCK_TOKEN }),
      })
    );
    await page.route('**/api/users', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USERS),
      })
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@example.com');
    await page.getByLabel('Password').fill('correctpassword');
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Registered Users' })).toBeVisible();
  });
});

test.describe('Auth redirect', () => {
  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible();
  });
});

test.describe('Dashboard (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateContext(page);
    await page.route('**/api/users', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USERS),
      })
    );
  });

  test('shows the users table with user data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Registered Users' })).toBeVisible();
    await expect(page.getByText('2 total')).toBeVisible();
    await expect(page.getByText('alice@example.com')).toBeVisible();
    await expect(page.getByText('bob@example.com')).toBeVisible();
  });

  test('shows correct auth method badges', async ({ page }) => {
    await page.goto('/');
    // bob has googleId → Google badge; alice does not → Email badge
    const rows = page.getByRole('row');
    await expect(rows.filter({ hasText: 'alice@example.com' }).getByText('Email')).toBeVisible();
    await expect(rows.filter({ hasText: 'bob@example.com' }).getByText('Google')).toBeVisible();
  });

  test('shows empty state when no users exist', async ({ page }) => {
    await page.route('**/api/users', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    );
    await page.goto('/');
    await expect(page.getByText('No users found')).toBeVisible();
  });

  test('shows error when users API fails', async ({ page }) => {
    await page.route('**/api/users', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    );
    await page.goto('/');
    await expect(page.getByText(/Failed to load users/)).toBeVisible();
  });

  test('Sign out clears session and redirects to /login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Admin Sign In' })).toBeVisible();
  });
});
