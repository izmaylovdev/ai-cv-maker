/**
 * @module api
 *
 * Framework-agnostic fetch wrappers for the `cv-api` auth endpoints.
 *
 * These are plain async functions — no Angular DI, no Redux, no RxJS.
 * Each app wraps them in its own state layer:
 *  - `ui-angular`: `AuthService` wraps them in `from()` to get Observables.
 *
 * Errors thrown by these functions always include a `.status` property with
 * the HTTP status code so callers can branch on 401 vs 409 vs 5xx.
 */

import type { AuthRequest, AuthResponse } from './models';

/**
 * Authenticate an existing user with email and password.
 *
 * @param request - `{ email, password }` credentials.
 * @param apiUrl  - Base API URL, e.g. `environment.apiUrl` (`…/api`).
 * @returns       Resolved `AuthResponse` with a fresh JWT on success.
 * @throws        Error with `.status = 401` for wrong credentials,
 *                or `.status = 5xx` for server errors.
 *
 * @example
 * const { token, email } = await loginApi({ email, password }, environment.apiUrl);
 * saveSession(token, email);
 */
export async function loginApi(
  request: AuthRequest,
  apiUrl: string
): Promise<AuthResponse> {
  const res = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const error = new Error(`Login failed: HTTP ${res.status}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<AuthResponse>;
}

/**
 * Register a new user with email and password.
 *
 * @param request - `{ email, password }` for the new account.
 * @param apiUrl  - Base API URL.
 * @returns       Resolved `AuthResponse` — the user is immediately logged in.
 * @throws        Error with `.status = 409` if the email is already taken,
 *                or `.status = 400` for validation failures.
 *
 * @example
 * const { token, email } = await registerApi({ email, password }, environment.apiUrl);
 * saveSession(token, email);
 */
export async function registerApi(
  request: AuthRequest,
  apiUrl: string
): Promise<AuthResponse> {
  const res = await fetch(`${apiUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const error = new Error(`Registration failed: HTTP ${res.status}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<AuthResponse>;
}

/**
 * Sign in (or sign up) using a Google One-Tap credential.
 *
 * The `credential` is the `id_token` JWT returned by the Google Identity
 * Services SDK. `cv-api` validates it server-side using the Google Auth
 * Library and either finds or creates a matching user record.
 *
 * @param credential - Google `id_token` string from the GSI callback.
 * @param apiUrl     - Base API URL.
 * @returns          Resolved `AuthResponse` with a fresh JWT on success.
 * @throws           Error with `.status = 401` if the Google token is invalid.
 *
 * @example
 * google.accounts.id.initialize({
 *   client_id: environment.googleClientId,
 *   callback: async ({ credential }) => {
 *     const res = await googleLoginApi(credential, environment.apiUrl);
 *     saveSession(res.token, res.email);
 *   },
 * });
 */
export async function googleLoginApi(
  credential: string,
  apiUrl: string
): Promise<AuthResponse> {
  const res = await fetch(`${apiUrl}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const error = new Error(`Google login failed: HTTP ${res.status}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<AuthResponse>;
}

/**
 * Exchange the HttpOnly refresh_token cookie for a new access JWT.
 *
 * The refresh token is sent automatically by the browser (HttpOnly cookie,
 * SameSite=Strict). On success the server rotates the cookie and returns a
 * fresh `{ token, email }`.
 *
 * @param apiUrl - Base API URL.
 * @returns      Fresh `AuthResponse` with a new access JWT.
 * @throws       Error with `.status = 401` when the refresh token is missing,
 *               expired, or already revoked.
 *
 * @example
 * try {
 *   const { token, email } = await refreshApi(environment.apiUrl);
 *   saveSession(token, email);
 * } catch {
 *   clearSession();
 *   // redirect to login
 * }
 */
export async function refreshApi(apiUrl: string): Promise<AuthResponse> {
  const res = await fetch(`${apiUrl}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const error = new Error(`Token refresh failed: HTTP ${res.status}`);
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return res.json() as Promise<AuthResponse>;
}

/**
 * Revoke the current refresh token and clear the HttpOnly cookie server-side.
 *
 * Call this on user-initiated logout. The server marks the refresh token as
 * revoked and issues a `Set-Cookie` that clears the `refresh_token` cookie.
 *
 * @param apiUrl - Base API URL.
 *
 * @example
 * await logoutApi(environment.apiUrl);
 * clearSession();
 * router.navigate(['/auth/login']);
 */
export async function logoutApi(apiUrl: string): Promise<void> {
  await fetch(`${apiUrl}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}
