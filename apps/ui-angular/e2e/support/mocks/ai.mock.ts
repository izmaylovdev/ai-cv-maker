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

export async function mockOptimizeUrlFetchErrorApi(page: Page, profileId: string, errorMessage: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({ status: 422, json: { error: errorMessage } });
  });
}

export async function mockChatApi(
  page: Page,
  profileId: string,
  reply: string,
  proposal: { type: string; description: string; patch: unknown } | null = null,
) {
  await page.route(`${API_URL}/job-profiles/${profileId}/chat`, (route) => {
    route.fulfill({ json: { reply, proposal } });
  });
}

export async function mockChatApiError(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/chat`, (route) => {
    route.fulfill({ status: 502, body: 'AI chat unavailable' });
  });
}

export async function registerFakeChatWidget(page: Page) {
  await page.addInitScript(() => {
    class FakeChatWidget extends HTMLElement {
      static get observedAttributes() {
        return ['profile-id', 'auth-token', 'api-base'];
      }
      connectedCallback() {
        this.setAttribute('data-loaded', 'true');
        this.innerHTML = '<div data-testid="chat-widget-inner"></div>';
      }
    }
    if (!customElements.get('ai-chat-widget')) {
      customElements.define('ai-chat-widget', FakeChatWidget);
    }
  });
  await page.route('**/chat-widget.js', (route) => route.fulfill({ body: '' }));
}
