import { Page } from '@playwright/test';

export async function setupAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('cv_token', 'fake-test-token');
    localStorage.setItem('cv_email', 'jane@example.com');
  });
}
