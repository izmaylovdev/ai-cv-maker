import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';
import { registerFakeProfileBuilder } from './support/mocks/builder.mock';

const PROFILE_ID = TEST_PROFILE_ID;

test.describe('Profile page (builder-based)', () => {
  test.beforeEach(async ({ page }) => {
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('renders the embedded profile builder web component', async ({ page }) => {
    await expect(page.locator('applysy-profile-builder')).toBeVisible();
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute('data-loaded', 'true');
  });

  test('shows the profile name in the header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Senior Backend Engineer' })).toBeVisible();
  });

  test('seeds the builder with the loaded document', async ({ page }) => {
    // The fake builder reflects the seeded document's header into data attrs.
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute('data-full-name', 'Jane Doe');
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute('data-title', 'Software Engineer');
  });

  test('saves the current document and shows a success notification', async ({ page }) => {
    let putBody: Record<string, unknown> = {};
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}`, (route) => {
      if (route.request().method() === 'PUT') {
        putBody = JSON.parse(route.request().postData() || '{}');
        route.fulfill({ json: { id: PROFILE_ID, name: putBody['name'], document: putBody['document'] } });
      } else {
        route.continue();
      }
    });

    await page.getByRole('button', { name: /Save Profile/ }).click();
    await expect(page.getByText('Profile saved successfully!')).toBeVisible();
    expect(putBody['name']).toBe('Senior Backend Engineer');
    expect((putBody['document'] as { header: { fullName: string } }).header.fullName).toBe('Jane Doe');
  });

  test('keeps edits from the builder and saves them', async ({ page }) => {
    let putBody: Record<string, unknown> = {};
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}`, (route) => {
      if (route.request().method() === 'PUT') {
        putBody = JSON.parse(route.request().postData() || '{}');
        route.fulfill({ json: { id: PROFILE_ID, name: putBody['name'], document: putBody['document'] } });
      } else {
        route.continue();
      }
    });

    // Wait until the loaded document has been seeded before editing, so the
    // edit isn't clobbered by the initial seed.
    await expect(page.locator('applysy-profile-builder')).toHaveAttribute('data-full-name', 'Jane Doe');

    // Simulate a user edit inside the builder (fires documentchange).
    await page.locator('applysy-profile-builder').evaluate((el) =>
      (el as unknown as { __edit(p: Record<string, unknown>): void }).__edit({ fullName: 'Edited Name' }),
    );

    await page.getByRole('button', { name: /Save Profile/ }).click();
    await expect(page.getByText('Profile saved successfully!')).toBeVisible();
    expect((putBody['document'] as { header: { fullName: string } }).header.fullName).toBe('Edited Name');
  });

  test('navigates back to job profiles list', async ({ page }) => {
    await page.getByRole('button', { name: 'Back to job profiles' }).click({ force: true });
    await expect(page).toHaveURL('/job-profiles');
  });
});

test.describe('Profile page error state', () => {
  test('shows error UI when API fails to load', async ({ page }) => {
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}`, (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal server error' } })
    );
    await page.goto(`/job-profiles/${PROFILE_ID}`);
    await expect(page.getByText('Failed to load profile.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
  });
});
