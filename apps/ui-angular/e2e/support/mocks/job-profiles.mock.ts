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

// Failing /extract: `body` is sent as-is — a string mimics cv-api's plain-text
// `StatusCode(503, "...")`, an object its global `{ code, message }` handlers.
// Also fulfils DELETE on the profile and reports whether it was called.
export async function mockJobProfilesExtractErrorApi(
  page: Page,
  profileId: string,
  status: number,
  body: string | object = '',
) {
  const calls = { deleted: false };
  await page.route(`${API_URL}/job-profiles/${profileId}/extract`, (route) => {
    if (typeof body === 'string') {
      route.fulfill({ status, contentType: 'text/plain; charset=utf-8', body });
    } else {
      route.fulfill({ status, json: body });
    }
  });
  await page.route(`${API_URL}/job-profiles/${profileId}`, (route) => {
    if (route.request().method() === 'DELETE') {
      calls.deleted = true;
      route.fulfill({ status: 204, body: '' });
    } else {
      route.continue();
    }
  });
  return calls;
}

// `extracted` is the new `{ name, document }` shape returned by /extract.
export async function mockJobProfilesExtractApi(
  page: Page,
  profileId: string,
  extracted: { name: string; document: unknown },
) {
  await page.route(`${API_URL}/job-profiles/${profileId}/extract`, (route) => {
    route.fulfill({ json: extracted });
  });
  await page.route(`${API_URL}/job-profiles/${profileId}`, (route) => {
    if (route.request().method() === 'PUT') {
      const body = JSON.parse(route.request().postData() || '{}');
      route.fulfill({ json: { id: profileId, name: body.name, document: extracted.document } });
    } else {
      route.continue();
    }
  });
}
