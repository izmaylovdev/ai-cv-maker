import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';
import { mockCvGenerateApi, mockCvGenerateFailApi, mockDefaultPdfApi, mockDraftPdfApi } from './support/mocks/cv.mock';
import { mockJobProfilesListApi } from './support/mocks/job-profiles.mock';
import { mockProfilesList } from './support/fixtures/profiles-list.fixture';
import { TEST_CV_ID, mockCvListItem } from './support/fixtures/cv.fixture';

const PROFILE_ID = TEST_PROFILE_ID;

// US-CV-7 — PDF button on profile editor opens the current profile directly (no dialog, no AI)
test.describe('Profile editor PDF button', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockProfileApi(page);
    await mockDraftPdfApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('navigates straight to the PDF preview without showing an intermediate dialog', async ({ page }) => {
    await page.getByRole('button', { name: /PDF/ }).click();
    await expect(page).toHaveURL(`/job-profiles/${PROFILE_ID}/pdf`);
    await expect(page.getByRole('heading', { name: 'Preview CV' })).not.toBeVisible();
  });

  test('renders the PDF iframe via the draft-pdf endpoint', async ({ page }) => {
    await page.getByRole('button', { name: /PDF/ }).click();
    await expect(page.locator('iframe[title="PDF Preview"]')).toBeVisible({ timeout: 10000 });
  });

  test('does not call the AI CV generation endpoint', async ({ page }) => {
    let generateCalled = false;
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}/cvs`, (route) => {
      if (route.request().method() === 'POST') generateCalled = true;
      route.continue();
    });

    const draftResponse = page.waitForResponse(
      (resp) => resp.url().includes('/cvs/draft-pdf') && resp.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /PDF/ }).click();
    await draftResponse;

    expect(generateCalled).toBe(false);
  });

  test('sends the current form state, including unsaved edits, to the draft-pdf endpoint', async ({ page }) => {
    let capturedBody: Record<string, unknown> = {};
    await page.route(`${API_URL}/cvs/draft-pdf`, (route) => {
      capturedBody = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') });
    });

    await page.getByLabel('Full Name', { exact: true }).fill('Edited Name Unsaved');

    const draftResponse = page.waitForResponse(
      (resp) => resp.url().includes('/cvs/draft-pdf') && resp.request().method() === 'POST'
    );
    await page.getByRole('button', { name: /PDF/ }).click();
    await draftResponse;

    expect(capturedBody['fullName']).toBe('Edited Name Unsaved');
  });
});

// US-CV-3 — PDF preview page: stable states (Back/Download buttons always present)
test.describe('CV PDF preview page', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockCvGenerateApi(page, PROFILE_ID);
    await page.goto(`/job-profiles/${PROFILE_ID}/pdf`);
  });

  test('shows Back navigation button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
  });

  test('shows Download button in the header', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Download/ })).toBeVisible();
  });

  test('renders PDF iframe after successful generation', async ({ page }) => {
    await expect(page.locator('iframe[title="PDF Preview"]')).toBeVisible({ timeout: 10000 });
  });

  // US-CV-4 — Download button is enabled once PDF loads
  test('Download button is enabled after PDF loads', async ({ page }) => {
    await expect(page.locator('iframe[title="PDF Preview"]')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Download/ })).toBeEnabled();
  });
});

// Loading-state tests use a slow mock so the transient state is catchable
test.describe('CV PDF preview page - loading state', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    // Delay the CV create response so the loading state is visible long enough to assert
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}/cvs`, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fulfill({ json: mockCvListItem });
    });
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}/cvs/${TEST_CV_ID}/pdf`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') })
    );
  });

  test('shows loading spinner while generating CV', async ({ page }) => {
    await page.goto(`/job-profiles/${PROFILE_ID}/pdf`);
    await expect(page.getByText('Loading PDF…')).toBeVisible();
  });

  test('Download button is disabled while loading', async ({ page }) => {
    await page.goto(`/job-profiles/${PROFILE_ID}/pdf`);
    await expect(page.getByRole('button', { name: /Download/ })).toBeDisabled();
  });
});

// US-CV-1 — Back navigation from PDF preview
test.describe('PDF preview navigation', () => {
  test('Back button returns to profile editor', async ({ page }) => {
    await setupAuth(page);
    await mockCvGenerateApi(page, PROFILE_ID);
    await page.goto(`/job-profiles/${PROFILE_ID}/pdf`);
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page).toHaveURL(`/job-profiles/${PROFILE_ID}`);
  });
});

// US-CV-1 — Error handling during generation
test.describe('CV generation error handling', () => {
  test('shows error notification when CV generation fails', async ({ page }) => {
    await setupAuth(page);
    await mockCvGenerateFailApi(page, PROFILE_ID);
    await page.goto(`/job-profiles/${PROFILE_ID}/pdf`);
    await expect(page.getByText('Failed to generate CV. Please try again.')).toBeVisible();
  });

  test('does not render PDF iframe on generation failure', async ({ page }) => {
    await setupAuth(page);
    await mockCvGenerateFailApi(page, PROFILE_ID);
    await page.goto(`/job-profiles/${PROFILE_ID}/pdf`);
    await expect(page.locator('iframe[title="PDF Preview"]')).not.toBeVisible();
  });
});

// US-CV-5 — Default profile PDF from job profiles page
test.describe('Default profile PDF (job profiles page)', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await mockDefaultPdfApi(page, mockProfilesList[0].id);
    await page.goto('/job-profiles');
  });

  test('shows Back button in default PDF viewer', async ({ page }) => {
    await page.locator('li').first().getByTitle('Open default CV').click();
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
  });

  test('closes inline PDF viewer and returns to list when Back is clicked', async ({ page }) => {
    await page.locator('li').first().getByTitle('Open default CV').click();
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByRole('heading', { name: 'Job Profiles' })).toBeVisible();
    await expect(page.locator('iframe[title="PDF Preview"]')).not.toBeVisible();
  });

  test('renders iframe once the default PDF loads', async ({ page }) => {
    await page.locator('li').first().getByTitle('Open default CV').click();
    await expect(page.locator('iframe[title="PDF Preview"]')).toBeVisible({ timeout: 10000 });
  });
});

// US-CV-5 — Default profile PDF loading state (uses slow mock to catch transient spinner)
test.describe('Default profile PDF - loading state', () => {
  test('shows PDF loading state when clicking the PDF icon on a card', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.route(`${API_URL}/job-profiles/${mockProfilesList[0].id}/cvs/default/pdf`, async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') });
    });
    await page.goto('/job-profiles');
    await page.locator('li').first().getByTitle('Open default CV').click();
    await expect(page.getByText('Loading PDF…')).toBeVisible();
  });
});

// US-CV-5 — PDF title includes profile name and title
test.describe('Default PDF title', () => {
  test('PDF viewer header shows profile name and job title', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await mockDefaultPdfApi(page, mockProfilesList[0].id);
    await page.goto('/job-profiles');

    await page.locator('li').first().getByTitle('Open default CV').click();
    // scope to the PDF viewer overlay to avoid matching p.truncate on profile cards beneath it
    await expect(page.locator('app-pdf-preview p').filter({ hasText: 'Jane Doe' })).toBeVisible();
  });
});
