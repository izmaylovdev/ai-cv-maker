# Admin Panel

A read-only view of registered users, plus the global AI spending limit. Served
by a dedicated NestJS backend (`admin-api`) behind a Next.js frontend
(`admin-ui`).

**Code:** `apps/admin-api/`, `apps/admin-ui/`, `apps/cv-api/Features/Admin/`
**See also:** [ADR-0005](../adr/0005-admin-api-via-cv-api.md) (admin-api reads via cv-api, not the main DB) ·
[ADR-0004](../adr/0004-admin-api-main-db-access.md) ·
[web-client/ai-usage.md](../web-client/ai-usage.md) (what the limit does)

---

## Topology

```
admin-ui (Next.js)
  ├─ /api/auth/*   — proxy route → admin-api  (avoids CORS)
  └─ /api/users    — proxy route → admin-api  (+ Bearer JWT)

admin-api (NestJS)
  ├─ POST /auth/google, POST /auth/login
  ├─ GET  /users            — JwtAuthGuard
  ├─ GET/PUT /usage-limit   — JwtAuthGuard
  ├─ admin PostgreSQL       — separate instance; table admin_users
  └─ cv-api  GET /api/admin/users, GET/PUT /api/admin/usage-limit
                            — X-Admin-Api-Key
```

**admin-api never touches the main database.** cv-api owns the `Users` and
`Profiles` schema and exposes a service-to-service surface guarded by
`AdminApiKeyFilter` (a shared API key, not the user JWT scheme). The admin
database holds only admin accounts. See
[ADR-0005](../adr/0005-admin-api-via-cv-api.md).

---

## Users list

The table is sorted by registration date, newest first, with a total count above
it. Columns: Email, Auth Method, Profiles, Registered, ID.

**Auth method** is derived, not stored: a non-null `GoogleId` shows as *Google*,
everything else as *Email*.

**Profile count** comes from cv-api's projection, which counts each user's
profiles; users with none show `0`.

`GET /api/admin/users` (cv-api) returns
`{ id, email, googleId, createdAt, profileCount }` per user. The projection lives
in `AdminUsersService` and is owned by cv-api — a change to the `Users` or
`Profiles` entities updates that query in the same change.

---

## Spending limit

`GET`/`PUT /api/admin/usage-limit` on cv-api reads and writes the global
`LlmUsageLimitUsd` app setting; admin-api proxies both and admin-ui exposes a
control. A non-positive or non-numeric value is rejected with `400`. The limit
applies to all users — see [web-client/ai-usage.md](../web-client/ai-usage.md)
for how it interacts with per-user billing allowances.

---

## Admin authentication

The login page offers **Sign in with Google** and an email/password form. Both
return the same JWT shape and both check membership in the `admin_users` table:

- **Google:** admin-api verifies the ID token (`google-auth-library`), then looks
  up the caller's email.
- **Email/password:** admin-api verifies the bcrypt hash stored on the row.

An account that is not in `admin_users` gets `403` and admin-ui shows "Access
denied". Bad credentials or an invalid token get `401`.

| | |
|---|---|
| Endpoint | `POST /auth/google` `{ idToken }` · `POST /auth/login` `{ email, password }` |
| Success | `{ accessToken }` |
| JWT | HS256, payload `{ sub, email }`, 8-hour expiry, signed with `JWT_SECRET` |
| Storage | `localStorage`; sent as `Authorization: Bearer <token>` |

All other admin-api routes require a valid JWT and return `401` without one.
admin-ui redirects unauthenticated users to `/login`, and any `401` from the API
triggers the same redirect. Sign out discards the token and returns to `/login`.

**Admin database schema** — a dedicated PostgreSQL instance, one table:

```sql
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,           -- nullable; bcrypt, for email/password login
  google_id     TEXT,           -- nullable; Google sub, for OAuth login
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

An admin may have either or both methods set. Allowed admins are seeded by
migration.

---

## Configuration

| Env var | Service | Purpose |
|---|---|---|
| `CV_API_URL` | admin-api | cv-api base URL (default `http://localhost:5050`) |
| `CV_API_ADMIN_KEY` | admin-api | Sent as `X-Admin-Api-Key`; must match cv-api's `AdminApi:ApiKey` |
| `ADMIN_API_URL` | admin-ui | admin-api base URL (default `http://localhost:3000`) |
| `GOOGLE_CLIENT_ID` | admin-api, admin-ui | Google OAuth client id |
| `JWT_SECRET` | admin-api | HS256 signing secret (≥ 32 chars) |
| `ADMIN_DB_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASSWORD` | admin-api | Admin PostgreSQL connection (port defaults to `5434`, name to `admin`) |

---

## Not implemented

User search, filtering, and pagination; deleting or modifying users; per-user
activity views (CV generation history, AI usage breakdown). cv-api can already
compute per-user usage aggregates (`UsageService.GetAllUserSummariesAsync`) but
no controller exposes them yet.
