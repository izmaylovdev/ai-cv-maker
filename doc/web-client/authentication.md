# Authentication

Every part of the app is behind a login. Users sign in with an email/password pair
or with Google, and stay signed in across browser restarts via a rotating refresh
token.

**Code:** `apps/ui-angular/src/app/auth/`, `apps/cv-api/Features/Auth/`, `libs/auth`
**See also:** [ARCHITECTURE.md — Authentication Flow](../../ARCHITECTURE.md#authentication-flow) ·
[ADR-0017 (Google sign-in trust)](../adr/0017-google-signin-token-trust.md) ·
[ADR-0001 (llm-service network privacy)](../adr/0001-llm-service-network-privacy.md)

---

## What a user can do

| | Behaviour |
|---|---|
| **Register** | Email + password on `/auth/register`. On success the user is signed in immediately and lands on `/job-profiles`. A second registration with the same email is refused. |
| **Log in** | Email + password on `/auth/login`. Wrong credentials produce one generic error — the response never says which of the two fields was wrong. |
| **Sign in with Google** | A Google button on the login and register screens. First sign-in creates the account; later ones sign in to it. If the Google email matches an existing password account, the two are linked rather than duplicated. |
| **Stay signed in** | The session survives closing the tab or the browser. The short-lived access token is refreshed silently in the background; the user only sees the login screen again after 30 days of not visiting, or after logging out. |
| **Log out** | Clears the session, revokes the refresh token server-side, and returns to the login screen. Every other open tab logs out at the same time. |

Protected routes (`/job-profiles`, `/job-profiles/:id`, `/job-profiles/:id/pdf`,
`/chat`, `/settings`, `/billing`) redirect to `/auth/login` when there is no valid
session. There is no return-to-original-page redirect — after logging in the user
lands on `/job-profiles`.

---

## How it works

**Tokens.** cv-api issues an HS256 JWT access token valid for **1 hour**, plus a
refresh token delivered as an `HttpOnly; Secure; SameSite=Strict` cookie named
`refresh_token`, scoped to `Path=/api/auth` and valid for **30 days**. Refresh
tokens are stored SHA-256-hashed in the `RefreshTokens` table and **rotated on
every use** — each refresh issues a new one and the old value stops working.

**Client storage.** The access token and the user's email live in `localStorage`
under the keys exported by `@applysy/auth` (`TOKEN_KEY` / `EMAIL_KEY` — never
hardcode the string). `libs/auth` owns all session reads and writes:
`saveSession()`, `getSession()`, `clearSession()`, and client-side JWT decoding
(`parseJwt`, `isTokenExpired`).

**Request path.** `apiInterceptor`
([api.interceptor.ts](../../apps/ui-angular/src/app/core/api.interceptor.ts))
attaches `Authorization: Bearer <token>` to every outgoing request. On a 401 from
a non-`/api/auth/` endpoint it calls `POST /api/auth/refresh` (the cookie rides
along automatically), retries the original request once with the fresh token, and
forces a logout if the refresh itself fails. Auth endpoints are excluded from that
retry so a failed login cannot loop.

**Cross-tab sync.** `createAuthBroadcast()` in `libs/auth` publishes a logout over
a `BroadcastChannel`, so signing out in one tab signs out every same-origin tab.

**Google sign-in.** The Angular client loads Google Identity Services and renders
the official button when `environment.googleClientId` is set; if it is unset the
button is simply not rendered. Three server-side flows exist, one per client type:

| Endpoint | Used by | Verification |
|---|---|---|
| `POST /api/auth/google` | Web One-Tap / button (ID token) | `GoogleJsonWebSignature.ValidateAsync`, audience pinned to `Google:WebClientId` |
| `POST /api/auth/google/code` | Web authorization-code flow (PKCE) | Code exchanged server-side using `Google:WebClientId` + `Google:ClientSecret` |
| `POST /api/auth/google/token` | Chrome extension (`chrome.identity.getAuthToken`) | Google `tokeninfo`; the token's `aud` must be in the allowlist of our own OAuth clients |

All three require `email_verified == true` plus a present subject and email before
an account is matched or created by email address — see
[ADR-0017](../adr/0017-google-signin-token-trust.md) for why. The trust check is a
pure, unit-tested function, `AuthService.IsTrustedGoogleToken`.

---

## API

All endpoints live under `api/auth` and return `AuthResponse` — `{ token, email }`
— on success. Errors are returned as plain-text messages with the status below.

| Endpoint | Body | Success | Failure |
|---|---|---|---|
| `POST /api/auth/register` | `{ email, password }` | `200` + sets refresh cookie | `400` invalid email / password < 8 chars / missing field · `409` email already registered |
| `POST /api/auth/login` | `{ email, password }` | `200` + sets refresh cookie | `401` `"Invalid email or password."` |
| `POST /api/auth/google` | `{ credential }` | `200` + sets refresh cookie | `400` missing credential · `401` invalid credential |
| `POST /api/auth/google/code` | `{ code, codeVerifier, redirectUri }` | `200` + sets refresh cookie | `400` missing code · `401` invalid code |
| `POST /api/auth/google/token` | `{ accessToken }` | `200` + sets refresh cookie | `400` missing token · `401` untrusted token |
| `POST /api/auth/refresh` | — (cookie) | `200` + rotated refresh cookie | `401` no / invalid / expired / revoked refresh token |
| `POST /api/auth/logout` | — (cookie) | `204`, refresh token revoked and cookie deleted | — |

CORS is locked to the known front-end origins with `AllowCredentials`, which the
refresh cookie requires.

---

## Rules and edge cases

- **Password policy is length-only:** minimum 8 characters, no character-class
  requirements. Hashes are bcrypt.
- **A `User` row carries `PasswordHash` and/or `GoogleId`.** Google-only accounts
  have no password hash; linking fills in `GoogleId` on an existing row.
- Registration rejects a malformed email before touching the database.
- An expired access token is not an error the user sees — the interceptor
  refreshes and retries. Only a failed refresh surfaces as a redirect to login.
- Logout is best-effort server-side: if no cookie is present it still returns
  `204` and clears the client session.

---

## Not implemented

Password reset, email verification, two-factor auth, account deletion, and
server-side blacklisting of access tokens (revocation applies to refresh tokens
only, so an already-issued access token stays valid for up to an hour after
logout).
