import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL } from './support/constants';

// US-SETTINGS-1 — Global preferences
test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await page.route(`${API_URL}/settings/preferences`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { globalPreferences: null } });
      } else {
        const body = route.request().postDataJSON();
        await route.fulfill({ json: { globalPreferences: body.globalPreferences } });
      }
    });
    await page.goto('/settings');
  });

  // F-SETTINGS-1.1
  test('settings link is visible in the navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  // F-SETTINGS-1.2
  test('shows Global Preferences section with a textarea', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /global preferences/i })).toBeVisible();
    await expect(page.getByPlaceholder('Add tone, formatting, or rules.')).toBeVisible();
  });

  // F-SETTINGS-1.4
  test('pre-fills textarea with saved preferences on load', async ({ page, context }) => {
    await page.route(`${API_URL}/settings/preferences`, (route) =>
      route.fulfill({ json: { globalPreferences: 'Use formal tone.' } })
    );
    await page.goto('/settings');
    await expect(page.getByPlaceholder('Add tone, formatting, or rules.')).toHaveValue('Use formal tone.');
  });

  // F-SETTINGS-1.3 + F-SETTINGS-1.5
  test('saves preferences and shows success notification', async ({ page }) => {
    const textarea = page.getByPlaceholder('Add tone, formatting, or rules.');
    await textarea.fill('Keep it concise. Use bullet points.');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();
  });
});
