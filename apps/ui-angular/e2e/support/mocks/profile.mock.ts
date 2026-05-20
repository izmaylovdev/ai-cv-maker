import { Page } from '@playwright/test';
import { API_URL, TEST_PROFILE_ID } from '../constants';
import { mockProfile } from '../fixtures/profile.fixture';

export async function mockProfileApi(
  page: Page,
  profile = mockProfile,
  id = TEST_PROFILE_ID
) {
  await page.route(`${API_URL}/job-profiles/${id}`, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: profile });
    } else if (route.request().method() === 'PUT') {
      route.fulfill({ json: profile });
    } else {
      route.continue();
    }
  });
}
