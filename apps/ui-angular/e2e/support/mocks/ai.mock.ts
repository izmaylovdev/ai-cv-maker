import { Page } from '@playwright/test';
import { API_URL } from '../constants';
import { mockProfile } from '../fixtures/profile.fixture';

export async function mockEnhanceFieldApi(page: Page, profileId: string, enhanced: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/enhance-field`, (route) => {
    route.fulfill({ json: { enhanced } });
  });
}

export async function mockEnhanceFieldFailApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/enhance-field`, (route) => {
    route.fulfill({ status: 502, body: 'Enhancement failed' });
  });
}

export async function mockOptimizeApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({
      json: {
        title: 'Senior TypeScript Engineer',
        overview: 'Optimized overview targeting fintech.',
        workExperiences: mockProfile.workExperiences.map((w) => ({
          company: w.company,
          role: w.role,
          startDate: w.startDate,
          endDate: w.endDate,
          description: 'Optimized description for ' + w.company,
        })),
        skills: [{ name: 'TypeScript' }, { name: 'Go' }, { name: 'Kubernetes' }],
      },
    });
  });
}

export async function mockOptimizeFailApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({ status: 502, body: 'Optimization failed' });
  });
}
