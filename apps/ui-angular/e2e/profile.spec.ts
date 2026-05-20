import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL, TEST_PROFILE_ID } from './support/constants';
import { mockProfileApi } from './support/mocks/profile.mock';

const PROFILE_ID = TEST_PROFILE_ID;

test.describe('Profile page', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    await mockProfileApi(page);
    await page.goto(`/job-profiles/${PROFILE_ID}`);
  });

  test('loads and displays profile data', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Senior Backend Engineer' })).toBeVisible();
    await expect(page.getByPlaceholder('John Doe')).toHaveValue('Jane Doe');
    await expect(page.getByPlaceholder('Senior Software Engineer')).toHaveValue('Software Engineer');
    await expect(page.getByPlaceholder('Berlin, Germany')).toHaveValue('Berlin, Germany');
  });

  test('shows work experience loaded from API', async ({ page }) => {
    await expect(page.getByText('Experience 1')).toBeVisible();
    await expect(page.getByPlaceholder('Acme Corp')).toHaveValue('Acme Corp');
    await expect(page.locator('input[formcontrolname="role"]')).toHaveValue('Lead Engineer');
  });

  test('shows education loaded from API', async ({ page }) => {
    await expect(page.getByPlaceholder('MIT')).toHaveValue('TU Berlin');
    await expect(page.getByPlaceholder('Bachelor of Science')).toHaveValue('MSc');
  });

  test('shows skills loaded from API', async ({ page }) => {
    const skillInputs = page.getByPlaceholder('Skill');
    await expect(skillInputs.nth(0)).toHaveValue('TypeScript');
    await expect(skillInputs.nth(1)).toHaveValue('Go');
  });

  test('adds and removes a work experience entry', async ({ page }) => {
    await page.getByRole('button', { name: /Add Experience/ }).click();
    await expect(page.getByText('Experience 2')).toBeVisible();

    // delete the newly added entry using its inline delete button
    const exp2 = page.locator('[formArrayName="workExperiences"] > div').nth(1);
    await exp2.getByRole('button').click();
    await expect(page.getByText('Experience 2')).not.toBeVisible();
  });

  test('adds and removes a skill', async ({ page }) => {
    await page.getByRole('button', { name: /Add Skill/ }).click();
    const skillInputs = page.getByPlaceholder('Skill');
    await expect(skillInputs).toHaveCount(3);

    await page.locator('[formArrayName="skills"] button').last().click();
    await expect(skillInputs).toHaveCount(2);
  });

  test('shows validation errors on save with empty required fields', async ({ page }) => {
    await page.getByPlaceholder('John Doe').fill('');
    await page.getByPlaceholder('John Doe').blur();
    await page.getByRole('button', { name: /Save Profile/ }).click();
    await expect(page.getByText('Full name is required')).toBeVisible();
  });

  test('saves profile and shows success notification', async ({ page }) => {
    await page.getByRole('button', { name: /Save Profile/ }).click();
    await expect(page.getByText('Profile saved successfully!')).toBeVisible();
  });

  test('opens reorder sections modal', async ({ page }) => {
    await page.getByRole('button', { name: /Reorder/ }).click();
    await expect(page.getByRole('heading', { name: 'Reorder Sections' })).toBeVisible();
    const overlay = page.locator('cdk-dialog-container');
    await expect(overlay.getByText('Work Experience')).toBeVisible();
    await expect(overlay.getByText('Education')).toBeVisible();
    await expect(overlay.getByText('Skills')).toBeVisible();
  });

  test('reorder widget applies new section order to modal list and form', async ({ page }) => {
    await page.getByRole('button', { name: /Reorder/ }).click();
    await expect(page.getByRole('heading', { name: 'Reorder Sections' })).toBeVisible();

    const overlay = page.locator('cdk-dialog-container');
    const dragItems = overlay.locator('[cdkdrag]');

    // Confirm initial order in the modal drag list
    await expect(dragItems.nth(0)).toContainText('Work Experience');
    await expect(dragItems.nth(1)).toContainText('Education');
    await expect(dragItems.nth(2)).toContainText('Skills');

    // Drag Work Experience (index 0) down to the Skills (index 2) position
    const handle = dragItems.nth(0).locator('[cdkdraghandle]');
    const dropTarget = dragItems.nth(2);

    const handleBox = await handle.boundingBox();
    const targetBox = await dropTarget.boundingBox();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 20 },
    );
    await page.mouse.up();

    // Modal drag list should reflect new order before Apply
    await expect(dragItems.nth(0)).toContainText('Education');
    await expect(dragItems.nth(1)).toContainText('Skills');
    await expect(dragItems.nth(2)).toContainText('Work Experience');

    // Apply
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { name: 'Reorder Sections' })).not.toBeVisible();

    // Form sections must appear in the same new order
    const formSectionOrder = await page.locator('form h3').evaluateAll((els) =>
      els
        .map((el) => el.textContent?.trim() ?? '')
        .filter((t) => ['Work Experience', 'Education', 'Skills'].includes(t)),
    );
    expect(formSectionOrder).toEqual(['Education', 'Skills', 'Work Experience']);

    // Preview sections must reflect the same order (preview uses "Experience" not "Work Experience")
    const previewSectionOrder = await page.locator('app-profile-preview h2').evaluateAll((els) =>
      els
        .map((el) => el.textContent?.trim() ?? '')
        .filter((t) => ['Experience', 'Education', 'Skills'].includes(t)),
    );
    expect(previewSectionOrder).toEqual(['Education', 'Skills', 'Experience']);
  });

  test('closes reorder modal on Cancel', async ({ page }) => {
    await page.getByRole('button', { name: /Reorder/ }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Reorder Sections' })).not.toBeVisible();
  });

  test('navigates back to job profiles list', async ({ page }) => {
    // sticky preview column can overlap this button at certain viewport heights
    await page.getByRole('button', { name: 'Back to job profiles' }).click({ force: true });
    await expect(page).toHaveURL('/job-profiles');
  });
});

test.describe('Profile page error state', () => {
  test('shows error UI when API fails to load', async ({ page }) => {
    await setupAuth(page);
    await page.route(`${API_URL}/job-profiles/${PROFILE_ID}`, (route) =>
      route.fulfill({ status: 500, json: { error: 'Internal server error' } })
    );
    await page.goto(`/job-profiles/${PROFILE_ID}`);
    await expect(page.getByText('Failed to load profile.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
  });
});
