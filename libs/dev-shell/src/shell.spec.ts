import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ai-cv-maker/auth', () => ({
  getSession: vi.fn(() => ({ token: null, email: '' })),
  saveSession: vi.fn(),
  clearSession: vi.fn(),
  loginApi: vi.fn(),
  googleLoginApi: vi.fn(),
}));

vi.mock('@ai-cv-maker/theme', () => ({
  getTheme: vi.fn(() => 'light' as const),
  saveTheme: vi.fn(),
  applyTheme: vi.fn(),
}));

import * as auth from '@ai-cv-maker/auth';
import * as theme from '@ai-cv-maker/theme';
import { mountDevShell } from './shell';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

const CONFIG = {
  widgetSelector: '#widget',
  apiBase: 'http://localhost:5050/api',
  googleClientId: 'test-client-id',
  title: 'test widget',
};

describe('mountDevShell', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="widget"></div>';
    vi.mocked(auth.getSession).mockReturnValue({ token: null, email: '' });
    vi.mocked(theme.getTheme).mockReturnValue('light');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // --- DOM structure ---

  it('inserts #__dev-shell__ bar into document.body', () => {
    mountDevShell(CONFIG);
    expect(document.getElementById('__dev-shell__')).not.toBeNull();
  });

  it('renders a theme toggle button', () => {
    mountDevShell(CONFIG);
    expect(document.querySelector('[data-testid="theme-toggle"]')).not.toBeNull();
  });

  it('applies initial theme on mount', () => {
    mountDevShell(CONFIG);
    expect(vi.mocked(theme.applyTheme)).toHaveBeenCalledWith('light');
  });

  // --- Auth: logged out ---

  it('shows login form when no session', () => {
    mountDevShell(CONFIG);
    expect(document.querySelector('[data-testid="login-form"]')).not.toBeNull();
  });

  it('shows Google sign-in button when no session', () => {
    mountDevShell(CONFIG);
    expect(document.querySelector('[data-testid="google-signin"]')).not.toBeNull();
  });

  it('does not show logout button when no session', () => {
    mountDevShell(CONFIG);
    expect(document.querySelector('[data-testid="logout-btn"]')).toBeNull();
  });

  // --- Auth: logged in ---

  it('shows user email when session exists', () => {
    vi.mocked(auth.getSession).mockReturnValue({ token: 'tok', email: 'user@example.com' });
    mountDevShell(CONFIG);
    expect(document.querySelector<HTMLElement>('[data-testid="user-email"]')?.textContent).toBe('user@example.com');
  });

  it('shows logout button when session exists', () => {
    vi.mocked(auth.getSession).mockReturnValue({ token: 'tok', email: 'user@example.com' });
    mountDevShell(CONFIG);
    expect(document.querySelector('[data-testid="logout-btn"]')).not.toBeNull();
  });

  it('does not show login form when session exists', () => {
    vi.mocked(auth.getSession).mockReturnValue({ token: 'tok', email: 'user@example.com' });
    mountDevShell(CONFIG);
    expect(document.querySelector('[data-testid="login-form"]')).toBeNull();
  });

  // --- Email/password login ---

  it('calls loginApi with credentials on form submit', async () => {
    vi.mocked(auth.loginApi).mockResolvedValue({ token: 'newTok', email: 'a@b.com' });
    mountDevShell(CONFIG);

    const form = document.querySelector<HTMLFormElement>('[data-testid="login-form"]')!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value = 'a@b.com';
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = 'secret';
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await flushPromises();

    expect(vi.mocked(auth.loginApi)).toHaveBeenCalledWith(
      { email: 'a@b.com', password: 'secret' },
      CONFIG.apiBase
    );
  });

  it('saves session and sets auth-token on widget after email login', async () => {
    vi.mocked(auth.loginApi).mockResolvedValue({ token: 'newTok', email: 'a@b.com' });
    mountDevShell(CONFIG);

    const form = document.querySelector<HTMLFormElement>('[data-testid="login-form"]')!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value = 'a@b.com';
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = 'secret';
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    await flushPromises();

    expect(vi.mocked(auth.saveSession)).toHaveBeenCalledWith('newTok', 'a@b.com');
    expect(document.querySelector('#widget')!.getAttribute('auth-token')).toBe('newTok');
  });

  // --- Google login ---

  it('initialises GIS with googleClientId on Google button click', () => {
    let capturedClientId = '';
    vi.stubGlobal('google', {
      accounts: {
        id: {
          initialize: vi.fn((opts: { client_id: string }) => { capturedClientId = opts.client_id; }),
          prompt: vi.fn(),
        },
      },
    });

    mountDevShell(CONFIG);
    document.querySelector<HTMLButtonElement>('[data-testid="google-signin"]')!.click();

    expect(capturedClientId).toBe('test-client-id');
    vi.unstubAllGlobals();
  });

  it('saves session and sets auth-token when GIS credential callback fires', async () => {
    vi.mocked(auth.googleLoginApi).mockResolvedValue({ token: 'gTok', email: 'g@example.com' });

    let credentialCallback!: (response: { credential: string }) => void;
    vi.stubGlobal('google', {
      accounts: {
        id: {
          initialize: vi.fn((opts: { callback: typeof credentialCallback }) => {
            credentialCallback = opts.callback;
          }),
          prompt: vi.fn(),
        },
      },
    });

    mountDevShell(CONFIG);
    document.querySelector<HTMLButtonElement>('[data-testid="google-signin"]')!.click();
    credentialCallback({ credential: 'google-id-token' });

    await flushPromises();

    expect(vi.mocked(auth.googleLoginApi)).toHaveBeenCalledWith('google-id-token', CONFIG.apiBase);
    expect(vi.mocked(auth.saveSession)).toHaveBeenCalledWith('gTok', 'g@example.com');
    expect(document.querySelector('#widget')!.getAttribute('auth-token')).toBe('gTok');
    vi.unstubAllGlobals();
  });

  // --- Logout ---

  it('calls clearSession on logout', () => {
    vi.mocked(auth.getSession).mockReturnValue({ token: 'tok', email: 'user@example.com' });
    mountDevShell(CONFIG);

    document.querySelector<HTMLButtonElement>('[data-testid="logout-btn"]')!.click();

    expect(vi.mocked(auth.clearSession)).toHaveBeenCalled();
  });

  it('removes auth-token from widget on logout', () => {
    vi.mocked(auth.getSession).mockReturnValue({ token: 'tok', email: 'user@example.com' });
    document.querySelector('#widget')!.setAttribute('auth-token', 'tok');
    mountDevShell(CONFIG);

    document.querySelector<HTMLButtonElement>('[data-testid="logout-btn"]')!.click();

    expect(document.querySelector('#widget')!.getAttribute('auth-token')).toBeNull();
  });

  // --- Theme toggle ---

  it('toggles from light to dark on first click', () => {
    vi.mocked(theme.getTheme).mockReturnValue('light');
    mountDevShell(CONFIG);

    document.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')!.click();

    expect(vi.mocked(theme.saveTheme)).toHaveBeenCalledWith('dark');
    expect(vi.mocked(theme.applyTheme)).toHaveBeenCalledWith('dark');
  });

  it('toggles from dark to light on first click', () => {
    vi.mocked(theme.getTheme).mockReturnValue('dark');
    mountDevShell(CONFIG);

    document.querySelector<HTMLButtonElement>('[data-testid="theme-toggle"]')!.click();

    expect(vi.mocked(theme.saveTheme)).toHaveBeenCalledWith('light');
    expect(vi.mocked(theme.applyTheme)).toHaveBeenCalledWith('light');
  });
});
