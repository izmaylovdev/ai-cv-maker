/**
 * @module storage
 *
 * Thin wrappers around `localStorage` for reading and writing the auth session.
 *
 * All functions guard against environments where `localStorage` is unavailable
 * (SSR, unit tests without a DOM stub) by checking `typeof localStorage`.
 *
 * **Why localStorage instead of HttpOnly cookies?**
 * The current `cv-api` issues tokens as a JSON response body, not a Set-Cookie
 * header. Migrating to HttpOnly cookies requires server changes (see the auth
 * audit notes in `ARCHITECTURE.md`). Until then, localStorage is the pragmatic
 * choice — mitigate XSS risk at the application level (CSP, sanitisation).
 */

import { EMAIL_KEY, TOKEN_KEY } from './constants';
import type { AuthSession } from './models';

/**
 * Read the full auth session (token + email) from localStorage.
 *
 * Safe to call at module initialisation time (e.g. as Redux initial state).
 * Returns `{ token: null, email: '' }` when there is no active session or
 * when localStorage is not available.
 *
 * @example
 * // Redux initial state
 * const initialState: AuthState = getSession();
 */
export function getSession(): AuthSession {
  if (typeof localStorage === 'undefined') return { token: null, email: '' };
  return {
    token: localStorage.getItem(TOKEN_KEY),
    email: localStorage.getItem(EMAIL_KEY) ?? '',
  };
}

/**
 * Read only the JWT string from localStorage.
 *
 * Convenience function for HTTP interceptors that only need the raw token.
 * Returns `null` when there is no active session.
 *
 * @example
 * // Angular HTTP interceptor
 * const token = getToken();
 * if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
 */
export function getToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Persist a successful auth response to localStorage.
 *
 * Call this after a successful login, registration, or token refresh.
 * Both `ui-angular` and `ui-react` write to the same keys, so a login in
 * one app is immediately visible to the other on the next read.
 *
 * @param token - The JWT returned by `cv-api`.
 * @param email - The user's email address (stored for display without JWT decode).
 */
export function saveSession(token: string, email: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

/**
 * Remove session data from localStorage.
 *
 * Call this on logout **before** broadcasting the logout event so that if
 * another tab reads storage in response to the broadcast it sees no token.
 */
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}
