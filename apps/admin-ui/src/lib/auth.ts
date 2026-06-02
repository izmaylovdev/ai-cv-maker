const TOKEN_KEY = 'admin_token';
const COOKIE_NAME = 'admin_authed';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  // Middleware-readable flag cookie (no sensitive data, JS-readable for logout)
  document.cookie = `${COOKIE_NAME}=1; path=/; SameSite=Strict`;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
