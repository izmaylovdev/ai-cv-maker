import { Page } from '@playwright/test';
import { API_URL } from '../constants';
import { mockOptimizedDocument } from '../fixtures/profile.fixture';

// US-AI-2 — Full profile optimization. Returns a rewritten ProfileDocument.
export async function mockOptimizeApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({ json: { document: mockOptimizedDocument } });
  });
}

export async function mockOptimizeFailApi(page: Page, profileId: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({ status: 502, body: 'Optimization failed' });
  });
}

export async function mockOptimizeLimitApi(page: Page, profileId: string, message: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({
      status: 402,
      json: { code: 'usage_limit_exceeded', message, limitUsd: 0.5 },
    });
  });
}

export async function mockOptimizeUrlFetchErrorApi(page: Page, profileId: string, errorMessage: string) {
  await page.route(`${API_URL}/job-profiles/${profileId}/optimize`, (route) => {
    route.fulfill({ status: 422, json: { error: errorMessage } });
  });
}

// US-AI-4 — Conversational profile chat (web component on the /chat page).
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

// US-AI-9 — In-editor chat editing. Reuses POST /api/chat; when the request
// carries a `document` the response includes an ops-based `proposal`.
export async function mockChatEditApi(
  page: Page,
  reply: string,
  proposal: { type: string; description: string; patchJson: string } | null = null,
) {
  await page.route(`${API_URL}/chat`, (route) => {
    route.fulfill({ json: { reply, proposal } });
  });
}

export async function registerFakeChatWidget(page: Page) {
  await page.addInitScript(() => {
    class FakeChatWidget extends HTMLElement {
      static get observedAttributes() {
        return ['profile-id', 'auth-token', 'api-base'];
      }
      private _document: unknown = null;

      // Host (Angular) syncs the open document onto this property for context.
      get document() {
        return this._document;
      }
      set document(value: unknown) {
        this._document = value;
        this.setAttribute('data-has-document', value ? 'true' : 'false');
      }

      connectedCallback() {
        this.setAttribute('data-loaded', 'true');
        this.innerHTML = '<div data-testid="chat-widget-inner"></div>';
      }

      // Test hook: simulate the assistant returning an edit (US-AI-9 §6.3).
      __emitEdit(patchJson: string, description = '') {
        this.dispatchEvent(
          new CustomEvent('edit', {
            detail: { patchJson, description },
            bubbles: true,
            composed: true,
          }),
        );
      }

      // Host calls this to surface a rejected/failed edit in the thread (F-CHAT-6.10).
      addAssistantNote(text: string) {
        this.setAttribute('data-last-note', text);
      }
    }
    if (!customElements.get('ai-chat-widget')) {
      customElements.define('ai-chat-widget', FakeChatWidget);
    }
  });
  await page.route('**/chat-widget.js', (route) => route.fulfill({ body: '' }));
}
