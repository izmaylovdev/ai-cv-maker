import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL } from './support/constants';
import { mockJobProfilesListApi, mockEmptyProfilesListApi, mockJobProfilesExtractApi } from './support/mocks/job-profiles.mock';
import { mockDefaultPdfApi } from './support/mocks/cv.mock';
import { mockProfilesList } from './support/fixtures/profiles-list.fixture';

// US-PROF-1 — View all profiles
test.describe('Job profiles list', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
  });

  test('shows page heading and profile cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Job Profiles' })).toBeVisible();
    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
    await expect(page.getByText('ML Researcher')).toBeVisible();
  });

  test('shows full name and title as subtitle on each card', async ({ page }) => {
    await expect(page.getByText('Jane Doe · Software Engineer')).toBeVisible();
    await expect(page.getByText('Jane Doe · ML Engineer')).toBeVisible();
  });

  test('shows PDF and delete action buttons on each card', async ({ page }) => {
    const firstCard = page.locator('li').first();
    await expect(firstCard.getByTitle('Open default CV')).toBeVisible();
    await expect(firstCard.getByTitle('Delete profile')).toBeVisible();
  });
});

// US-PROF-1 — Empty state
test.describe('Job profiles empty state', () => {
  test('shows empty state prompt when no profiles exist', async ({ page }) => {
    await setupAuth(page);
    await mockEmptyProfilesListApi(page);
    await page.goto('/job-profiles');
    await expect(page.getByText('No job profiles yet. Create one to get started.')).toBeVisible();
  });
});

// US-PROF-2 — Create blank profile
test.describe('Create blank profile', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
  });

  test('toggles create form when clicking New Profile', async ({ page }) => {
    await page.getByRole('button', { name: /New Profile/ }).click();
    await expect(page.getByLabel('Profile name')).toBeVisible();
  });

  test('creates profile and navigates to editor', async ({ page }) => {
    await page.getByRole('button', { name: /New Profile/ }).click();
    await page.getByLabel(/Profile name/).fill('Data Engineer');
    // accessible name includes the material-icon text "add", so match substring
    await page.locator('button').filter({ hasText: 'Create' }).click();
    await expect(page).toHaveURL('/job-profiles/new-profile-id');
  });

  test('creates profile with default name when name is blank', async ({ page }) => {
    await page.getByRole('button', { name: /New Profile/ }).click();
    await page.locator('button').filter({ hasText: 'Create' }).click();
    await expect(page).toHaveURL('/job-profiles/new-profile-id');
  });

  test('closes create form when Cancel is clicked', async ({ page }) => {
    await page.getByRole('button', { name: /New Profile/ }).click();
    await expect(page.getByLabel(/Profile name/)).toBeVisible();
    await page.getByRole('button', { name: /Cancel/ }).click();
    await expect(page.getByLabel(/Profile name/)).not.toBeVisible();
  });
});

// US-PROF-3 — Bootstrap profile from CV upload
test.describe('Create profile from CV upload', () => {
  test('shows file upload area when create form is open', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
    await page.getByRole('button', { name: /New Profile/ }).click();
    await expect(page.getByText('Upload PDF')).toBeVisible();
  });

  test('imports CV and navigates to profile editor', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);

    const extractedProfile = {
      name: 'My Profile',
      fullName: 'Alex Smith',
      title: 'Backend Developer',
      overview: 'Experienced backend developer.',
      location: 'Berlin',
      contacts: { email: 'alex@example.com', phone: '' },
      workExperiences: [],
      educations: [],
      skills: [],
      sectionOrder: ['workExperiences', 'educations', 'skills'],
    };
    await mockJobProfilesExtractApi(page, 'new-profile-id', extractedProfile);

    await page.goto('/job-profiles');
    await page.getByRole('button', { name: /New Profile/ }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'my-cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });

    await expect(page.getByText('my-cv.pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: /Import & Create/ })).toBeVisible();

    await page.getByRole('button', { name: /Import & Create/ }).click();
    await expect(page).toHaveURL('/job-profiles/new-profile-id');
  });

  test('removes selected file when clear button is clicked', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
    await page.getByRole('button', { name: /New Profile/ }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });
    await expect(page.getByText('cv.pdf')).toBeVisible();

    // click the close button that is a sibling of the filename span inside the file card
    await page.locator('span').filter({ hasText: 'cv.pdf' }).locator('xpath=..').locator('button').click();
    await expect(page.getByText('cv.pdf')).not.toBeVisible();
    await expect(page.getByText('Upload PDF')).toBeVisible();
  });
});

// US-PROF-4 — Delete profile
test.describe('Delete profile', () => {
  test('removes deleted profile from list', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');

    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
    const firstCard = page.locator('li').first();
    await firstCard.getByTitle('Delete profile').click();
    await expect(page.getByText('Senior Backend Engineer')).not.toBeVisible();
  });

  test('delete does not remove other profiles', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');

    const firstCard = page.locator('li').first();
    await firstCard.getByTitle('Delete profile').click();
    await expect(page.getByText('ML Researcher')).toBeVisible();
  });
});

// US-PROF-5 — Navigate to profile editor
test.describe('Navigate to profile editor', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
  });

  test('navigates to profile editor when clicking a card', async ({ page }) => {
    await page.goto('/job-profiles');
    await page.locator('li').first().click();
    await expect(page).toHaveURL(`/job-profiles/${mockProfilesList[0].id}`);
  });
});

// Error state
test.describe('Job profiles list error state', () => {
  test('shows error UI with Retry button when API fails', async ({ page }) => {
    await setupAuth(page);
    await page.route(`${API_URL}/job-profiles`, (route) =>
      route.fulfill({ status: 500, json: { error: 'Server error' } })
    );
    await page.goto('/job-profiles');
    await expect(page.getByText('Failed to load job profiles.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
  });

  test('reloads profiles after clicking Retry', async ({ page }) => {
    await setupAuth(page);
    let callCount = 0;
    await page.route(`${API_URL}/job-profiles`, (route) => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({ status: 500, json: { error: 'Server error' } });
      } else {
        route.fulfill({ json: mockProfilesList });
      }
    });
    await page.goto('/job-profiles');
    await expect(page.getByText('Failed to load job profiles.')).toBeVisible();
    await page.getByRole('button', { name: /Retry/ }).click();
    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
  });
});

// US-CV-5 — Default profile PDF from job profiles page
test.describe('Default profile PDF preview', () => {
  test('opens inline PDF viewer when clicking the PDF icon', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await mockDefaultPdfApi(page, mockProfilesList[0].id);
    await page.goto('/job-profiles');

    await page.locator('li').first().getByTitle('Open default CV').click();
    await expect(page.getByText('Loading PDF…')).toBeVisible();
  });

  test('shows download button in PDF viewer header', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await mockDefaultPdfApi(page, mockProfilesList[0].id);
    await page.goto('/job-profiles');

    await page.locator('li').first().getByTitle('Open default CV').click();
    await expect(page.getByRole('button', { name: /Download/ })).toBeVisible();
  });

  test('closes PDF viewer when Back is clicked', async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await mockDefaultPdfApi(page, mockProfilesList[0].id);
    await page.goto('/job-profiles');

    await page.locator('li').first().getByTitle('Open default CV').click();
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByRole('heading', { name: 'Job Profiles' })).toBeVisible();
  });
});
