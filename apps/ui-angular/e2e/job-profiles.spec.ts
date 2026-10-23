import { test, expect, Page } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL } from './support/constants';
import { mockJobProfilesListApi, mockEmptyProfilesListApi, mockJobProfilesExtractApi, mockJobProfilesExtractErrorApi } from './support/mocks/job-profiles.mock';
import { mockDefaultPdfApi } from './support/mocks/cv.mock';
import { registerFakeProfileBuilder } from './support/mocks/builder.mock';
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
      document: {
        header: {
          fullName: 'Alex Smith',
          title: 'Backend Developer',
          email: 'alex@example.com',
          phone: '',
          location: 'Berlin',
        },
        sections: [
          { id: 's1', template: 'free-form', heading: 'Summary', body: 'Experienced backend developer.' },
        ],
      },
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
    await expect(page.getByText("Couldn't import your CV.")).not.toBeVisible();
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

// A failed CV import is reported, and leaves no empty profile behind.
test.describe('Create profile from CV upload — import fails', () => {
  async function submitImport(page: Page, name = '') {
    await page.goto('/job-profiles');
    await page.getByRole('button', { name: /New Profile/ }).click();
    if (name) await page.getByLabel(/Profile name/).fill(name);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'my-cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });
    await page.getByRole('button', { name: /Import & Create/ }).click();
  }

  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
  });

  test('shows the plain-text server message and stays on the form', async ({ page }) => {
    const message =
      'CV extraction is temporarily unavailable: the AI service is unreachable. Please try again later.';
    const calls = await mockJobProfilesExtractErrorApi(page, 'new-profile-id', 503, message);

    await submitImport(page, 'Data Engineer');

    await expect(page.getByText(`Couldn't import your CV. ${message}`)).toBeVisible();
    await expect(page).toHaveURL('/job-profiles');
    // Form kept for a one-click retry.
    await expect(page.getByLabel(/Profile name/)).toHaveValue('Data Engineer');
    await expect(page.getByText('my-cv.pdf')).toBeVisible();
    await expect(page.getByRole('button', { name: /Import & Create/ })).toBeEnabled();
    // The empty profile is removed.
    await expect.poll(() => calls.deleted).toBe(true);
  });

  test('shows the message from a JSON { code, message } body', async ({ page }) => {
    await mockJobProfilesExtractErrorApi(page, 'new-profile-id', 503, {
      code: 'llm_unavailable',
      message: 'The AI service is currently unreachable. Please try again later.',
    });

    await submitImport(page);

    await expect(
      page.getByText("Couldn't import your CV. The AI service is currently unreachable. Please try again later."),
    ).toBeVisible();
    await expect(page).toHaveURL('/job-profiles');
  });

  test('falls back to a status-specific message when the body is empty', async ({ page }) => {
    await mockJobProfilesExtractErrorApi(page, 'new-profile-id', 400, '');

    await submitImport(page);

    await expect(page.getByText(/Couldn't import your CV\. We couldn't read any text from that file\./)).toBeVisible();
    await expect(page).toHaveURL('/job-profiles');
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

// US-PROF-7 — Rename a profile (dashboard rows)
test.describe('Rename profile on dashboard', () => {
  let patchBodies: Record<string, unknown>[];

  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();

    // Capture name-only PATCH calls (F-PROF-7.4). Registered after the list
    // mock so it takes precedence for this URL; other methods fall back.
    patchBodies = [];
    await page.route(`${API_URL}/job-profiles/${mockProfilesList[0].id}`, (route) => {
      if (route.request().method() === 'PATCH') {
        const body = JSON.parse(route.request().postData() || '{}');
        patchBodies.push(body);
        route.fulfill({
          json: { id: mockProfilesList[0].id, name: body.name, fullName: 'Jane Doe', title: 'Software Engineer' },
        });
      } else {
        route.fallback();
      }
    });
  });

  test('shows a rename action on every profile row', async ({ page }) => {
    // F-PROF-7.1 — visible rename (pencil) action per row.
    await expect(page.locator('li').first().getByTitle('Rename profile')).toBeVisible();
    await expect(page.locator('li').nth(1).getByTitle('Rename profile')).toBeVisible();
  });

  test('activating rename does not navigate into the profile', async ({ page }) => {
    // F-PROF-7.2 — the rename action never opens the editor.
    await page.locator('li').first().getByTitle('Rename profile').click();
    await expect(page).toHaveURL('/job-profiles');
  });

  test('saves the new name on Enter via a name-only PATCH', async ({ page }) => {
    // F-PROF-7.1/7.2/7.4
    const firstCard = page.locator('li').first();
    await firstCard.getByTitle('Rename profile').click();
    const input = firstCard.getByRole('textbox');
    await expect(input).toBeVisible();
    await input.fill('Platform Engineer');
    await input.press('Enter');

    await expect(page.getByText('Platform Engineer')).toBeVisible();
    await expect(page.getByText('Senior Backend Engineer')).not.toBeVisible();
    expect(patchBodies).toHaveLength(1);
    // The rename call carries the name and nothing else — never the document.
    expect(patchBodies[0]).toEqual({ name: 'Platform Engineer' });
  });

  test('saves the new name on click-away (blur)', async ({ page }) => {
    // F-PROF-7.2 — blur commits the edit.
    const firstCard = page.locator('li').first();
    await firstCard.getByTitle('Rename profile').click();
    const input = firstCard.getByRole('textbox');
    await input.fill('Contract Roles');
    await page.getByRole('heading', { name: 'Job Profiles' }).click();

    await expect(page.getByText('Contract Roles')).toBeVisible();
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]).toEqual({ name: 'Contract Roles' });
  });

  test('Escape cancels the edit and restores the previous name', async ({ page }) => {
    // F-PROF-7.2 — Escape never saves.
    const firstCard = page.locator('li').first();
    await firstCard.getByTitle('Rename profile').click();
    const input = firstCard.getByRole('textbox');
    await input.fill('Should Not Be Saved');
    await input.press('Escape');

    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
    await expect(page.getByText('Should Not Be Saved')).not.toBeVisible();
    expect(patchBodies).toHaveLength(0);
  });

  test('a blank name is rejected and the previous name kept', async ({ page }) => {
    // F-PROF-7.5 — whitespace-only edit is cancelled client-side, no API call.
    const firstCard = page.locator('li').first();
    await firstCard.getByTitle('Rename profile').click();
    const input = firstCard.getByRole('textbox');
    await input.fill('   ');
    await input.press('Enter');

    await expect(page.getByText('Senior Backend Engineer')).toBeVisible();
    expect(patchBodies).toHaveLength(0);
  });
});

// US-PROF-8 — Imported profiles get a meaningful name
test.describe('CV import derives profile name', () => {
  const extractedDoc = {
    header: {
      fullName: 'Alex Smith',
      title: 'Staff Platform Engineer',
      email: 'alex@example.com',
      phone: '',
      location: 'Berlin',
    },
    sections: [
      { id: 's1', template: 'free-form', heading: 'Summary', body: 'Experienced platform engineer.' },
    ],
  };

  // Mocks POST /extract returning `extractedName`, captures the follow-up PUT
  // bodies, and serves GET with the last persisted name so the editor header
  // reflects what the client saved.
  async function mockImportApis(page: import('@playwright/test').Page, extractedName: string) {
    const putBodies: Record<string, unknown>[] = [];
    let currentName = 'My Profile';
    await page.route(`${API_URL}/job-profiles/new-profile-id/extract`, (route) =>
      route.fulfill({ json: { name: extractedName, document: extractedDoc } })
    );
    await page.route(`${API_URL}/job-profiles/new-profile-id`, (route) => {
      const method = route.request().method();
      if (method === 'PUT') {
        const body = JSON.parse(route.request().postData() || '{}');
        putBodies.push(body);
        currentName = body['name'] as string;
        route.fulfill({ json: { id: 'new-profile-id', name: currentName, document: body['document'] } });
      } else if (method === 'GET') {
        route.fulfill({ json: { id: 'new-profile-id', name: currentName, document: extractedDoc } });
      } else {
        route.fallback();
      }
    });
    return putBodies;
  }

  async function attachCvAndImport(page: import('@playwright/test').Page) {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'my-cv.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fake'),
    });
    await page.getByRole('button', { name: /Import & Create/ }).click();
    await expect(page).toHaveURL('/job-profiles/new-profile-id');
  }

  test.beforeEach(async ({ page }) => {
    await registerFakeProfileBuilder(page);
    await setupAuth(page);
    await mockJobProfilesListApi(page);
    await page.goto('/job-profiles');
    await page.getByRole('button', { name: /New Profile/ }).click();
  });

  test('uses the LLM-derived name when the name field is left blank', async ({ page }) => {
    // F-PROF-8.3/8.4 — blank name + CV → derived name is persisted.
    const putBodies = await mockImportApis(page, 'Staff Platform Engineer');
    await attachCvAndImport(page);

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]['name']).toBe('Staff Platform Engineer');
  });

  test('shows the derived name in the profile editor header after import', async ({ page }) => {
    // US-PROF-8 — the derived name, not the "My Profile" placeholder.
    await mockImportApis(page, 'Staff Platform Engineer');
    await attachCvAndImport(page);

    await expect(page.getByRole('heading', { name: 'Staff Platform Engineer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Profile' })).not.toBeVisible();
  });

  test('a typed name wins over the derived name', async ({ page }) => {
    // F-PROF-8.4 — user input takes precedence.
    const putBodies = await mockImportApis(page, 'Staff Platform Engineer');
    await page.getByLabel(/Profile name/).fill('My Custom Name');
    await attachCvAndImport(page);

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]['name']).toBe('My Custom Name');
  });

  test('keeps the My Profile default when extraction yields no usable name', async ({ page }) => {
    // F-PROF-8.5 — the API echoes the current name when the LLM gave none.
    const putBodies = await mockImportApis(page, 'My Profile');
    await attachCvAndImport(page);

    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]['name']).toBe('My Profile');
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
