import { Page } from '@playwright/test';
import { API_URL } from '../constants';
import { TEST_CV_ID, mockCvListItem } from '../fixtures/cv.fixture';

const FAKE_PDF = Buffer.from('%PDF-1.4 fake-pdf-content');

export async function mockCvGenerateApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/cvs`, (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ json: mockCvListItem });
    } else {
      route.continue();
    }
  });

  await page.route(`${API_URL}/job-profiles/${profileId}/cvs/${TEST_CV_ID}/pdf`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: FAKE_PDF,
    });
  });
}

export async function mockDefaultPdfApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/cvs/default/pdf`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: FAKE_PDF,
    });
  });
}

export async function mockDraftPdfApi(page: Page) {
  await page.route(`${API_URL}/cvs/draft-pdf`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: FAKE_PDF,
    });
  });
}

export async function mockCvGenerateFailApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/cvs`, (route) => {
    route.fulfill({ status: 502, body: 'CV generation failed' });
  });
}
