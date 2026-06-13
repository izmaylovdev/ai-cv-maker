# ADR-0004: admin-api read-only access to the main database

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

`admin-api` (NestJS) owns its own admin database (`admin_users` and sessions)
but also reads the **main** cv-maker database directly to list end users:
`UsersService.findAll()` runs a single `SELECT … FROM "Users" LEFT JOIN
"Profiles" …`. It connects via `DB_*` env vars; `ADMIN_DB_*` points at its own DB.

Two services now read one schema with no contract between them. The review
flagged the risks: (a) any cv-api EF Core migration can silently break an
admin-api query, and (b) admin-api connected with the **same superuser
credentials** as cv-api, so a bug or compromise in the admin plane could write
to or destroy user data despite only ever needing to read it.

Confirmed by inspection: admin-api's main-DB pool (`PG_POOL`) is used in exactly
one place, a `SELECT`. There are no INSERT/UPDATE/DELETE against it.

## Decision

Keep the direct read — building a cv-api REST endpoint + auth surface purely for
an admin user list is not worth it at this scale — but make it **explicit and
least-privilege**:

1. **Dedicated read-only Postgres role** `admin_readonly` on the main DB:
   `LOGIN`, `CONNECT`, `USAGE` on `public`, `SELECT` on all tables, plus
   `ALTER DEFAULT PRIVILEGES … GRANT SELECT` so future migration tables stay
   readable. Created by `apps/admin-api/migrations/create-readonly-role.sql`.
2. **Production admin-api connects as `admin_readonly`**, password from Secret
   Manager (`admin-readonly-db-password`, var `admin_readonly_db_password`),
   wired to `DB_USER` / `DB_PASSWORD` in Terraform. Its `ADMIN_DB_*`
   (own database) is unchanged.
3. **Constraint:** admin-api must never write to the main DB. If it ever needs
   to, that must go through a cv-api API, not by widening this role.
4. **Local dev** (docker-compose) keeps using the superuser for simplicity —
   the role exists only in deployed environments. Documented here so the
   discrepancy is intentional, not an oversight.

## Alternatives considered

- **cv-api exposes an admin users endpoint:** cleaner contract, but adds an
  authenticated cross-service API and auth wiring for one read. Deferred — the
  read-only role gives most of the safety for far less work. Revisit if
  admin-api's main-DB queries grow beyond a couple of simple reads.
- **Keep superuser, rely on code review:** rejected — no enforcement; one bad
  query or injection bug reaches user data with full rights.
- **Logical replica / read replica for admin-api:** over-engineered for one
  `SELECT`; doubles DB cost.

## Consequences

- A compromised or buggy admin-api cannot mutate user data — the DB rejects it.
- New shared-table reads work automatically (default privileges); a cv-api
  migration that *renames/drops* a column admin-api selects still breaks the
  query — the coupling is reduced, not eliminated. The query lives in
  `apps/admin-api/src/app/users/users.service.ts` and should be checked when
  the `Users`/`Profiles` shape changes.
- One manual operator step per environment: run the SQL once via Cloud SQL Auth
  Proxy (see DEPLOY.md). The role password is a new secret to manage/rotate.
- Follow-up (from ADR-0002): admin-api still runs as the default compute SA;
  giving it a dedicated SA is tracked there, independent of this change.
