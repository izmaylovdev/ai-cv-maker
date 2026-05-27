/**
 * @module token
 *
 * Client-side JWT utilities — decode and inspect tokens without verifying
 * their signatures. Signature verification always happens server-side;
 * the browser only needs to read claims (e.g. `exp`) to avoid unnecessary
 * API round-trips.
 *
 * None of these functions make network calls or import third-party JWT
 * libraries — they perform a plain base64url decode of the payload segment.
 */

import type { JwtPayload } from './models';

/**
 * Decode a JWT and return its payload claims without verifying the signature.
 *
 * Returns `null` if the input is missing, not a valid three-segment JWT, or
 * if the payload segment is not valid base64url-encoded JSON.
 *
 * @param token - A compact-serialised JWT string (`header.payload.signature`).
 *
 * @example
 * const payload = parseJwt(getToken());
 * if (payload) console.log('logged in as', payload.email);
 */
export function parseJwt(token: string): JwtPayload | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Return `true` when the token is missing, malformed, or its `exp` claim is
 * within 30 seconds of expiring (clock-skew buffer).
 *
 * Use this to guard route activation and to decide whether to attempt a
 * silent token refresh before making an API call.
 *
 * @param token - JWT string, or `null`/`undefined` for a missing session.
 *
 * @example
 * // Angular signal initialisation
 * readonly isLoggedIn = signal(!isTokenExpired(getToken()));
 *
 * @example
 * // React ProtectedRoute
 * if (isTokenExpired(store.getState().auth.token)) navigate('/auth/login');
 */
export function isTokenExpired(token: string | null | undefined): boolean {
  if (!token) return true;
  const payload = parseJwt(token);
  if (!payload?.exp) return true;
  // Subtract 30-second buffer so the client refreshes slightly before the
  // server would actually reject the token.
  return payload.exp - 30 < Date.now() / 1000;
}

/**
 * Return the absolute `Date` at which the token expires, or `null` if the
 * token cannot be decoded.
 *
 * Useful for scheduling proactive token refresh or for displaying a
 * "session expires in X minutes" warning.
 *
 * @param token - A compact-serialised JWT string.
 *
 * @example
 * const expiry = getTokenExpiry(token);
 * if (expiry) console.log('token valid until', expiry.toLocaleString());
 */
export function getTokenExpiry(token: string): Date | null {
  const payload = parseJwt(token);
  if (!payload?.exp) return null;
  return new Date(payload.exp * 1000);
}
