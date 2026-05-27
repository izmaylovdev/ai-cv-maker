/**
 * Credentials sent by the user on login or registration.
 */
export interface AuthRequest {
  email: string;
  password: string;
}

/**
 * Successful authentication response from `cv-api`.
 * The token is a 7-day HS256 JWT; the email is a convenience copy
 * so the UI can display it without decoding the token.
 */
export interface AuthResponse {
  /** Signed JWT — store in sessionStorage or an in-memory signal/store. */
  token: string;
  email: string;
}

/**
 * The shape of the auth state that lives in the browser.
 * Mirrors what `getSession()` / `saveSession()` read and write.
 */
export interface AuthSession {
  /** `null` when the user is not logged in or the token has been cleared. */
  token: string | null;
  email: string;
}

/**
 * Claims carried inside the JWT issued by `cv-api`.
 * Decoded client-side only to read `exp` — never trusted for authorization.
 */
export interface JwtPayload {
  /** User UUID (maps to `ClaimTypes.NameIdentifier` on the server). */
  sub: string;
  email: string;
  /** Unix timestamp (seconds) when the token expires. */
  exp: number;
  /** Unix timestamp (seconds) when the token was issued. */
  iat?: number;
}
