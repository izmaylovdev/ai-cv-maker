import { clearSession, getSession, googleLoginApi, loginApi, saveSession } from '@ai-cv-maker/auth';
import { applyTheme, getTheme, saveTheme } from '@ai-cv-maker/theme';
import type { Theme } from '@ai-cv-maker/theme';
import { BAR_STYLES } from './styles';
import type { DevShellConfig } from './types';

type GoogleAccounts = {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback: (r: { credential: string }) => void }): void;
      renderButton(parent: HTMLElement, opts: { theme: string; size: string }): void;
    };
  };
};

function getGoogleAccounts(): GoogleAccounts | undefined {
  return (globalThis as Record<string, unknown>).google as GoogleAccounts | undefined;
}

function setWidgetToken(selector: string, token: string | null): void {
  const el = document.querySelector(selector);
  if (!el) return;
  if (token) {
    el.setAttribute('auth-token', token);
  } else {
    el.removeAttribute('auth-token');
  }
}

function renderAuth(container: HTMLElement, config: DevShellConfig): void {
  const session = getSession();
  container.innerHTML = '';

  if (session.token) {
    const email = document.createElement('span');
    email.dataset['testid'] = 'user-email';
    email.textContent = session.email;

    const logoutBtn = document.createElement('button');
    logoutBtn.dataset['testid'] = 'logout-btn';
    logoutBtn.textContent = 'Log out';
    logoutBtn.addEventListener('click', () => {
      clearSession();
      setWidgetToken(config.widgetSelector, null);
      renderAuth(container, config);
    });

    container.appendChild(email);
    container.appendChild(logoutBtn);
    return;
  }

  const form = document.createElement('form');
  form.dataset['testid'] = 'login-form';

  const emailInput = document.createElement('input');
  emailInput.name = 'email';
  emailInput.type = 'email';
  emailInput.placeholder = 'Email';

  const passwordInput = document.createElement('input');
  passwordInput.name = 'password';
  passwordInput.type = 'password';
  passwordInput.placeholder = 'Password';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Log in';

  form.append(emailInput, passwordInput, submitBtn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await loginApi({ email: emailInput.value, password: passwordInput.value }, config.apiBase);
      saveSession(res.token, res.email);
      setWidgetToken(config.widgetSelector, res.token);
      renderAuth(container, config);
    } catch {
      // errors visible in the console during dev
    }
  });

  const googleBtnContainer = document.createElement('div');
  googleBtnContainer.dataset['testid'] = 'google-signin';

  const initGis = () => {
    getGoogleAccounts()!.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async ({ credential }) => {
        try {
          const res = await googleLoginApi(credential, config.apiBase);
          saveSession(res.token, res.email);
          setWidgetToken(config.widgetSelector, res.token);
          renderAuth(container, config);
        } catch {
          // errors visible in the console during dev
        }
      },
    });
    getGoogleAccounts()!.accounts.id.renderButton(googleBtnContainer, { theme: 'filled_blue', size: 'small' });
  };

  if (getGoogleAccounts()) {
    initGis();
  } else {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = initGis;
    document.head.appendChild(script);
  }

  container.append(form, googleBtnContainer);
}

export function mountDevShell(config: DevShellConfig): void {
  const style = document.createElement('style');
  style.textContent = BAR_STYLES;
  document.head.appendChild(style);

  document.body.style.boxSizing = 'border-box';
  document.body.style.paddingTop = '40px';

  const bar = document.createElement('div');
  bar.id = '__dev-shell__';

  const title = document.createElement('span');
  title.className = 'dev-shell-title';
  title.textContent = config.title ?? config.widgetSelector;

  let currentTheme: Theme = getTheme();
  const themeBtn = document.createElement('button');
  themeBtn.dataset['testid'] = 'theme-toggle';
  themeBtn.textContent = currentTheme === 'dark' ? '☀' : '☾';
  themeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    saveTheme(currentTheme);
    applyTheme(currentTheme);
    themeBtn.textContent = currentTheme === 'dark' ? '☀' : '☾';
  });

  const authContainer = document.createElement('div');
  authContainer.className = 'dev-shell-auth';

  bar.append(title, themeBtn, authContainer);
  document.body.prepend(bar);

  applyTheme(currentTheme);
  renderAuth(authContainer, config);
}
