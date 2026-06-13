# Spec: Users Management

**Source user stories:** US-ADMIN-1 – US-ADMIN-3  
**Feature area:** Admin panel — registered users  
**Status:** Implemented (MVP)

---

## 1. Overview

The admin panel exposes a read-only view of all registered users. It is served by a dedicated NestJS backend (`admin-api`) and a Next.js frontend (`admin-ui`). `admin-api` does **not** access the main database; it reads the user list from cv-api's `GET /api/admin/users` over HTTP, authenticated with a shared API key ([ADR-0005](../../adr/0005-admin-api-via-cv-api.md)). cv-api owns the `Users`/`Profiles` schema.

---

## 2. Functional Requirements

### 2.1 List Users (US-ADMIN-1)

| # | Requirement |
|---|-------------|
| F-ADMIN-1.1 | The users table is sorted by registration date descending (newest first). |
| F-ADMIN-1.2 | The total user count is displayed above the table. |
| F-ADMIN-1.3 | Columns: Email, Auth Method, Profiles, Registered, ID. |

### 2.2 Auth Method Display (US-ADMIN-2)

| # | Requirement |
|---|-------------|
| F-ADMIN-2.1 | Users with a non-null `GoogleId` are labelled **Google**. |
| F-ADMIN-2.2 | All other users are labelled **Email**. |

### 2.3 Profile Count (US-ADMIN-3)

| # | Requirement |
|---|-------------|
| F-ADMIN-3.1 | Profile count is computed via a `LEFT JOIN` on the `Profiles` table. |
| F-ADMIN-3.2 | Users with no profiles display `0`. |

---

## 3. Technical Specification

### 3.1 Architecture

```
admin-ui (Next.js)
  └─ /api/users  (Next.js route — proxies to admin-api, avoids CORS)
        └─ admin-api (NestJS, port 3000)
              └─ GET /api/admin/users  (cv-api, X-Admin-Api-Key)
                    └─ PostgreSQL (cv-api owns it)
```

### 3.2 API Endpoint

#### `GET /api/users`

No authentication required for MVP (admin panel assumed to be internal/network-restricted).

**Response 200:**
```json
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "googleId": "1234567890",
    "createdAt": "2026-01-15T10:30:00Z",
    "profileCount": 3
  }
]
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (UUID) | User primary key |
| `email` | string | Unique user email |
| `googleId` | string \| null | Non-null for Google-authenticated users |
| `createdAt` | ISO 8601 datetime | UTC |
| `profileCount` | number | Count of associated profiles |

### 3.3 Data source

`admin-api` issues `GET ${CV_API_URL}/api/admin/users` with header `X-Admin-Api-Key: ${CV_API_ADMIN_KEY}`. The projection (sorted newest-first, profile count via `Profiles`) is owned by cv-api's `AdminUsersService`, which runs the EF Core equivalent of:

```sql
SELECT u."Id"       AS id,
       u."Email"    AS email,
       u."GoogleId" AS google_id,
       u."CreatedAt" AS created_at,
       COUNT(p."Id") AS profile_count
FROM "Users" u
LEFT JOIN "Profiles" p ON p."UserId" = u."Id"
GROUP BY u."Id", u."Email", u."GoogleId", u."CreatedAt"
ORDER BY u."CreatedAt" DESC
```

### 3.4 Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `CV_API_URL` | `http://localhost:5050` | cv-api base URL (admin-api → cv-api) |
| `CV_API_ADMIN_KEY` | _(none)_ | Shared key sent as `X-Admin-Api-Key`; must match cv-api's `AdminApi:ApiKey` |
| `ADMIN_API_URL` | `http://localhost:3000` | admin-api base URL (used by admin-ui proxy) |

> The admin-database (`ADMIN_DB_*`) variables, unchanged by this refactor, are listed in section 5.

---

## 4. Out of Scope (MVP)

- ~~Admin authentication / access control~~ — implemented in section 5
- User search and filtering
- Pagination
- User deletion or modification
- Detailed user activity (CV generation history, AI usage)

---

## 5. Admin Authentication — Google OAuth + JWT (US-ADMIN-4)

### 5.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-ADMIN-4.1 | The admin-ui login page renders both a "Sign in with Google" button and an email/password form. |
| F-ADMIN-4.2a | **Google path:** admin-api verifies the Google ID token and checks the caller's email against the `admin_users` table in the **admin database**. |
| F-ADMIN-4.2b | **Email/password path:** admin-api accepts `{ email, password }`, verifies the bcrypt hash stored in `admin_users`, and issues a JWT on match. |
| F-ADMIN-4.3 | If the account is not in `admin_users` (either path), admin-api returns `403 Forbidden` and admin-ui displays an "Access denied" message. |
| F-ADMIN-4.4 | Both paths return the same JWT shape on success; the frontend stores it in `localStorage` and sends it as `Authorization: Bearer <token>` on every subsequent request. |
| F-ADMIN-4.5 | All existing admin-api routes (`GET /users`) require a valid JWT; missing or invalid token returns `401`. |
| F-ADMIN-4.6 | Admin-ui redirects unauthenticated users to `/login`; any `401` response from the API also triggers the redirect. |
| F-ADMIN-4.7 | A "Sign out" button discards the JWT from `localStorage` and redirects to `/login`. |

### 5.2 Technical Specification

#### Architecture

```
admin-ui (Next.js)
  ├─ /login           — Google OAuth button (client-side Google Identity SDK)
  └─ /api/auth/google — Next.js proxy route → admin-api POST /auth/google
  └─ /api/users       — Next.js proxy route → admin-api GET /users (+ Bearer JWT)

admin-api (NestJS)
  ├─ POST /auth/google   — verifies Google ID token, checks admin DB, returns JWT
  ├─ GET  /users         — guarded by JwtAuthGuard
  └─ admin PostgreSQL    — separate DB instance, table: admin_users
```

#### API Endpoints

**`POST /auth/google`** — public, no JWT required

Request body:
```json
{ "idToken": "<Google ID token string>" }
```

Response `200`:
```json
{ "accessToken": "<JWT>" }
```

Error responses:
- `401` — Google ID token invalid or expired.
- `403` — Google account is not in the allowed admin list.

**`POST /auth/login`** — public, no JWT required

Request body:
```json
{ "email": "admin@example.com", "password": "secret" }
```

Response `200`:
```json
{ "accessToken": "<JWT>" }
```

Error responses:
- `401` — Email not found or password incorrect.
- `403` — Account exists but is not an authorized admin.

**`GET /users`** — requires `Authorization: Bearer <JWT>`

Response `401` when token is missing or invalid (unchanged from existing endpoint, now enforced).

#### JWT

| Field | Value |
|-------|-------|
| Algorithm | HS256 |
| Payload | `{ sub: adminUser.id, email: adminUser.email }` |
| Expiry | 8 hours |
| Secret | `JWT_SECRET` env var |

#### Admin database schema

New dedicated PostgreSQL instance (`admin-db`). Single table:

```sql
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,           -- nullable; bcrypt hash for email/password login
  google_id     TEXT,           -- nullable; Google sub for OAuth login
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

An admin may have either or both auth methods set. Seed with allowed admin emails (and optional password hashes) via a migration seed file.

#### NestJS modules

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | `POST /auth/google`, Google token verification (`google-auth-library`), JWT signing (`@nestjs/jwt`) |
| `JwtAuthGuard` | Validates Bearer JWT on all protected routes |
| `AdminUsersModule` | TypeORM entity + repository for `admin_users` table in admin DB |

#### Next.js frontend

| What | Where |
|------|-------|
| Login page | `app/login/page.tsx` — renders Google Identity button, calls `/api/auth/google`, stores JWT |
| Auth helper | `lib/auth.ts` — `getToken()`, `setToken()`, `clearToken()`, `isAuthenticated()` |
| API client | `lib/api.ts` — attaches `Authorization` header; intercepts `401` → redirect to `/login` |
| Route guard | middleware or layout check: redirect to `/login` if no token |

#### Configuration

| Env Var | Service | Description |
|---------|---------|-------------|
| `GOOGLE_CLIENT_ID` | admin-api, admin-ui | Google OAuth client ID |
| `JWT_SECRET` | admin-api | HS256 signing secret (≥ 32 chars) |
| `ADMIN_DB_HOST` | admin-api | Admin PostgreSQL host |
| `ADMIN_DB_PORT` | admin-api | Admin PostgreSQL port (default `5434`) |
| `ADMIN_DB_NAME` | admin-api | Admin database name (default `admin`) |
| `ADMIN_DB_USER` | admin-api | Admin database user |
| `ADMIN_DB_PASSWORD` | admin-api | Admin database password |

### 5.3 Out of Scope (MVP)

- Refresh tokens / token rotation
- Role-based permissions beyond "is admin"
- Admin user management UI (adding/removing admins done via DB seed)
- Audit log of admin actions
