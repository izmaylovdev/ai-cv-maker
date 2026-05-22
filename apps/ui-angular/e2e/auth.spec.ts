import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
  });

  test('shows sign in form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('shows invalid email error', async ({ page }) => {
    await page.getByPlaceholder('you@example.com').fill('notanemail');
    await page.getByPlaceholder('you@example.com').blur();
    await expect(page.getByText('Enter a valid email')).toBeVisible();
  });

  test('navigates to register page', async ({ page }) => {
    await page.getByRole('link', { name: 'Register', exact: true }).click();
    await expect(page).toHaveURL('/auth/register');
  });

  test('toggles password visibility', async ({ page }) => {
    const passwordInput = page.getByPlaceholder('••••••••');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await page.getByRole('button').filter({ has: page.locator('.material-icons') }).last().click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });
});

test.describe('Register page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/register');
  });

  test('shows create account form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
  });

  test('has link back to login', async ({ page }) => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/auth/login');
  });
});

test.describe('Auth guard', () => {
  test('redirects unauthenticated user from / to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('redirects unauthenticated user from /job-profiles to login', async ({ page }) => {
    await page.goto('/job-profiles');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

// US-AUTH-5 — Logout
test.describe('Logout', () => {
  test('logs out and redirects to login page', async ({ page }) => {
    const { setupAuth } = await import('./support/auth');
    const { mockJobProfilesListApi } = await import('./support/mocks/job-profiles.mock');
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
    await expect(page.getByRole('button', { name: /Logout/ })).toBeVisible();
    await page.getByRole('button', { name: /Logout/ }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('sidebar shows Login and Register links after logout', async ({ page }) => {
    const { setupAuth } = await import('./support/auth');
    const { mockJobProfilesListApi } = await import('./support/mocks/job-profiles.mock');
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
    await page.getByRole('button', { name: /Logout/ }).click();
    // scope to sidebar to avoid matching links inside the login form body
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('link', { name: /Login/ })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Register/ })).toBeVisible();
  });
});
