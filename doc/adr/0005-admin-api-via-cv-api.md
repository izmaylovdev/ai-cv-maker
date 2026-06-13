# ADR-0005: admin-api reads user data via a cv-api endpoint, not the main DB

- **Status:** Accepted
- **Date:** 2026-06-13
- **Supersedes:** [ADR-0004](0004-admin-api-main-db-access.md)

## Context

[ADR-0004](0004-admin-api-main-db-access.md) kept admin-api reading the **main**
cv-maker database directly (one `SELECT … FROM "Users" LEFT JOIN "Profiles"` in
`UsersService.findAll`), hardened only by a least-privilege `admin_readonly`
Postgres role. It explicitly listed "cv-api exposes an admin users endpoint" as
the cleaner alternative and deferred it as not worth the wiring "at this scale."

Two problems with the direct read remained, and ADR-0004 acknowledged both:

1. **Schema coupling with no contract.** Two services read one schema. A cv-api
   EF Core migration that renames or drops a `Users`/`Profiles` column admin-api
   selects silently breaks admin-api — the read-only role reduces the blast
   radius (no writes) but does nothing for this coupling.
2. **A second service holds main-DB credentials.** Even read-only, admin-api
   carries a login to the user database and a private-IP network path to it.
   That is a credential and an attack surface that exists only to power one
   read.

We are now reversing the deferral. The trigger named in ADR-0004 ("revisit if
admin-api's main-DB queries grow") is less relevant than the principle: cv-api
**owns** the user data and should be the only service that talks to its schema.

## Decision

**admin-api stops connecting to the main DB entirely.** User data is served by a
new cv-api endpoint:

1. **cv-api owns the read.** `GET /api/admin/users` (in `Features/Admin/`)
   returns `[{ id, email, googleId, createdAt, profileCount }]` from an EF Core
   query — the same projection admin-api used to run as raw SQL, now expressed
   against the entities cv-api already owns, so a migration that reshapes them
   updates this query in the same change.
2. **Shared-API-key auth.** The endpoint is **not** behind the user JWT scheme.
   It requires header `X-Admin-Api-Key`, compared (constant-time) against
   `AdminApi:ApiKey` from config (Secret Manager in prod). If the key is unset
   or the header is missing/wrong, the endpoint returns `401` — it never
   degrades to "open." cv-api has public ingress, so this in-app check, not edge
   IAM, is what protects the route ([ADR-0001](0001-llm-service-network-privacy.md)).
3. **admin-api calls over HTTP.** `UsersService` does a `GET` to
   `${CV_API_URL}/api/admin/users` with the key header. `CV_API_URL` points at
   cv-api's Cloud Run URL (a Google-fronted endpoint reachable through the
   existing Direct VPC egress + Private Google Access — no Cloud NAT, same path
   cv-api uses to reach llm-service). admin-api keeps its **own** admin DB
   (`ADMIN_DB_*`) unchanged.
4. **One shared secret.** `cv-api-admin-key` in Secret Manager
   (var `cv_api_admin_key`) is granted `secretAccessor` to **both** the cv-api
   runtime SA (to validate) and admin-api's runtime SA (to send). It replaces
   the `admin-readonly-db-password` secret.
5. **Decommission ADR-0004's machinery.** The `admin_readonly` role, the
   `admin-readonly-db-password` secret, the `DB_*` (main) env on admin-api, and
   `apps/admin-api/migrations/create-readonly-role.sql` are removed. Operators
   drop the role once per environment (DEPLOY.md).
6. **Local dev** (docker-compose): admin-api no longer depends on the main
   `postgres` service; it calls `cv-api` with a dev key shared via
   `CV_API_ADMIN_KEY`.

## Alternatives considered

- **Google-signed ID token (mirror cv-api→llm-service):** the more "GCP-native"
  option and avoids a long-lived shared secret. Rejected for now because
  cv-api's ingress is public, so unlike the llm-service hop there is no edge IAM
  to lean on — cv-api would have to validate the OIDC token *and* the caller SA
  in-app, which is more code than an API-key check for the same effective trust
  boundary (one trusted caller). Revisit if more services start calling cv-api
  admin endpoints or if shared-secret rotation becomes a burden.
- **Forward the admin's own JWT:** would couple cv-api to admin-api's signing
  key and give cv-api an "admin user" concept it otherwise has no need for.
  Over-scoped for a service-to-service list call.
- **Keep ADR-0004's direct read:** rejected — see Context; the coupling and the
  second DB credential are exactly what this change removes.

## Consequences

- **Single owner of user data.** Only cv-api reads `Users`/`Profiles`. The
  cross-service schema contract is now an HTTP DTO, versioned with the code that
  owns it; a breaking entity change and its query fix land together.
- **admin-api loses all main-DB access** — no role, no password, no network path
  to the user DB. Its blast radius shrinks to its own admin DB plus whatever the
  one cv-api endpoint exposes.
- **New coupling:** admin-api now needs cv-api reachable to list users (a 5xx or
  timeout surfaces as an admin-side error instead of a DB error). Acceptable —
  the admin panel is already a thin operational tool.
- **Secret swap, not net-new:** `cv-api-admin-key` replaces
  `admin-readonly-db-password`; rotation story is unchanged (edit tfvars,
  apply, redeploy both consumers).
- **One manual decommission step per environment:** drop the now-unused
  `admin_readonly` role after the new revisions are live (DEPLOY.md).
- **Follow-up (from ADR-0002):** admin-api still runs as the default compute SA.
  Giving it a dedicated SA is tracked there and would tighten who can read
  `cv-api-admin-key`; independent of this change.
