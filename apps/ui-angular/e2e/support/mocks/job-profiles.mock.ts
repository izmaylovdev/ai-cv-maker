import { Page } from '@playwright/test';
import { API_URL } from '../constants';
import { mockProfilesList } from '../fixtures/profiles-list.fixture';

export async function mockJobProfilesListApi(page: Page, profiles = mockProfilesList) {
  await page.route(`${API_URL}/job-profiles`, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: profiles });
    } else if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      route.fulfill({
        status: 200,
        json: { id: 'new-profile-id', name: body.name || 'My Profile', fullName: '', title: '' },
      });
    } else {
      route.continue();
    }
  });

  for (const profile of profiles) {
    await page.route(`${API_URL}/job-profiles/${profile.id}`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 204, body: '' });
      } else {
        route.continue();
      }
    });
  }
}

export async function mockEmptyProfilesListApi(page: Page) {
  await mockJobProfilesListApi(page, []);
}

export async function mockJobProfilesExtractApi(page: Page, profileId: string, extracted: object) {
  await page.route(`${API_URL}/job-profiles/${profileId}/extract`, (route) => {
    route.fulfill({ json: extracted });
  });
  await page.route(`${API_URL}/job-profiles/${profileId}`, (route) => {
    if (route.request().method() === 'PUT') {
      route.fulfill({ json: { id: profileId, ...extracted } });
    } else {
      route.continue();
    }
  });
}
