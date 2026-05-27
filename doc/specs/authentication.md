# Spec: Authentication

**Source user stories:** US-AUTH-1 – US-AUTH-5  
**Feature area:** Registration, login, and session management  
**Status:** Draft

---

## 1. Overview

All application routes are protected. A user must be authenticated before accessing any feature. Two authentication methods are supported: email/password and Google OAuth (One-Tap). Sessions are persisted via JWT so users remain logged in across browser restarts.

---

## 2. Functional Requirements

### 2.1 Registration (US-AUTH-1)

| # | Requirement |
|---|-------------|
| F-AUTH-1.1 | The registration form collects `email` and `password`. |
| F-AUTH-1.2 | On success the user is immediately logged in and redirected to `/profiles`. |
| F-AUTH-1.3 | A duplicate email returns HTTP 409; the UI displays: _"An account with this email already exists."_ |
| F-AUTH-1.4 | Passwords must meet minimum complexity rules (see §3.3). |

### 2.2 Email/Password Login (US-AUTH-2)

| # | Requirement |
|---|-------------|
| F-AUTH-2.1 | The login form collects `email` and `password`. |
| F-AUTH-2.2 | Invalid credentials return HTTP 401; the UI displays a generic message that does not reveal which field is wrong (e.g., _"Invalid email or password."_). |
| F-AUTH-2.3 | On success the user is redirected to `/profiles`. |

### 2.3 Google OAuth / One-Tap (US-AUTH-3)

| # | Requirement |
|---|-------------|
| F-AUTH-3.1 | A "Sign in with Google" button is visible on both the login and registration screens. |
| F-AUTH-3.2 | First-time Google sign-in creates a new account automatically. |
| F-AUTH-3.3 | Subsequent Google sign-ins log the user in to the existing account. |
| F-AUTH-3.4 | If a user already has an email/password account with the same Google email, accounts are linked (no duplicate created). |

### 2.4 Session Persistence (US-AUTH-4)

| # | Requirement |
|---|-------------|
| F-AUTH-4.1 | A JWT access token is issued on login/registration. |
| F-AUTH-4.2 | The token is stored in `localStorage` or an `HttpOnly` cookie (see §3.2 for decision). |
| F-AUTH-4.3 | Returning users with a valid, non-expired token are automatically authenticated. |
| F-AUTH-4.4 | Expired tokens result in a silent redirect to `/login`. |

### 2.5 Logout (US-AUTH-5)

| # | Requirement |
|---|-------------|
| F-AUTH-5.1 | A "Log out" action is accessible from the main navigation. |
| F-AUTH-5.2 | Clicking "Log out" clears the stored token and redirects to `/login`. |
| F-AUTH-5.3 | Accessing any protected route after logout redirects to `/login` without error. |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `POST /api/auth/register`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | ✓ | Must be a valid email format |
| `password` | string | ✓ | Min 8 chars, see §3.3 |

**Response 201:**
```json
{ "accessToken": "<jwt>", "user": { "id": "uuid", "email": "..." } }
```

**Response 409:** `{ "error": "EMAIL_TAKEN" }`  
**Response 422:** `{ "error": "VALIDATION_ERROR", "fields": { ... } }`

---

#### `POST /api/auth/login`

| Field | Type | Required |
|-------|------|----------|
| `email` | string | ✓ |
| `password` | string | ✓ |

**Response 200:**
```json
{ "accessToken": "<jwt>", "user": { "id": "uuid", "email": "..." } }
```

**Response 401:** `{ "error": "INVALID_CREDENTIALS" }`

---

#### `POST /api/auth/google`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `idToken` | string | ✓ | Google ID token from One-Tap |

**Response 200/201:**
```json
{ "accessToken": "<jwt>", "user": { "id": "uuid", "email": "..." }, "created": false }
```
(`created: true` on first sign-in.)

---

#### `POST /api/auth/logout`

Requires: `Authorization: Bearer <token>`

**Response 204:** No content. Server-side token blacklisting (if applicable).

---

### 3.2 JWT & Token Storage

- Algorithm: **HS256** (or RS256 if asymmetric keys preferred).
- Access token TTL: **7 days**.
- Storage strategy: **`HttpOnly` cookie** (preferred for XSS resistance) OR `localStorage` + `Authorization` header. Document the chosen approach in `ARCHITECTURE.md`.
- Refresh tokens: out of scope for MVP; re-authentication after expiry.

### 3.3 Password Policy

| Rule | Value |
|------|-------|
| Minimum length | 8 characters |
| Maximum length | 128 characters |
| Required character classes | None (length-based policy) |
| Bcrypt rounds | 12 |

### 3.4 Route Guards

- All routes under `/profiles`, `/profiles/:id`, `/profiles/:id/generate`, etc. require a valid JWT.
- Unauthenticated requests to protected routes redirect to `/login?redirect=<original_path>`.
- After login, redirect to the original path (or `/profiles` if none).

### 3.5 Google One-Tap Integration

- Use the `@react-oauth/google` library (or equivalent).
- Client ID configured via `VITE_GOOGLE_CLIENT_ID` environment variable.
- The backend verifies the `idToken` with Google's tokeninfo endpoint before issuing its own JWT.

### 3.6 Error States & UX

| Scenario | UI Behaviour |
|----------|-------------|
| Network error on login/register | Toast: _"Something went wrong. Please try again."_ |
| Google One-Tap dismissed | No error; button remains available |
| Token expired mid-session | Redirect to `/login`; after re-login return to the last route |

---

## 4. Data Model

```ts
// User entity
interface User {
  id: string;           // UUID v4
  email: string;        // unique, lowercase
  passwordHash?: string; // null for Google-only accounts
  googleId?: string;    // null for email/password-only accounts
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 5. Out of Scope (MVP)

- Password reset / forgot password flow
- Email verification
- Two-factor authentication
- Account deletion
- Refresh token rotation
