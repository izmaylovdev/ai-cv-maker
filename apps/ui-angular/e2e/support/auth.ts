import { Page } from '@playwright/test';

const _payload = { sub: 'test-user', email: 'jane@example.com', exp: 9999999999 };
const _base64Payload = Buffer.from(JSON.stringify(_payload)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
export const FAKE_TOKEN = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${_base64Payload}.fake-signature`;

export async function setupAuth(page: Page) {
  const token = FAKE_TOKEN;
  await page.addInitScript(({ token }) => {
    localStorage.setItem('cv_token', token);
    localStorage.setItem('cv_email', 'jane@example.com');
  }, { token });
}
