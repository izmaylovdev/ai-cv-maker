# ADR-0009: Smallest Cloud SQL tier (db-f1-micro) for the idle platform

- **Status:** Superseded by [ADR-0021](0021-firestore-replaces-cloud-sql.md) (the databases moved to Firestore; this ADR's "stopped by default" operating model was drift — the instance had been `RUNNABLE` and billing continuously)
- **Date:** 2026-06-16

## Context

Following the Cloud Run idle-cost work (ADR-0008), the remaining recurring spend
is the Cloud SQL instance `ai-cv-maker-postgres`. Cloud SQL has **no
scale-to-zero**: while running it bills its full machine tier 24/7; while
stopped it bills storage only. The platform has no production traffic.

The instance was on `db-g1-small` (1 shared vCPU, 1.7 GB RAM) in the
`ENTERPRISE` edition.

## Decision

We will run the database on the **smallest available tier, `db-f1-micro`**
(shared vCPU, ~0.6 GB RAM), keeping the `ENTERPRISE` edition (shared-core tiers
are not available on `ENTERPRISE_PLUS`).

This is the lowest-cost always-on option that keeps the app deployable on
demand. The instance also remains **stopped by default** (it is started only to
develop or demo), so this tier governs cost only while it is running.

## Alternatives considered

- **Stay on `db-g1-small`.** Roughly 2–3× the hourly cost of `db-f1-micro` for
  RAM the idle platform does not use. No SLA benefit (see below).
- **Move to a custom machine type (`db-custom-*`).** Minimum is 1 dedicated vCPU
  / 3.75 GB — larger and more expensive than the shared-core tiers, the wrong
  direction for cost minimisation.
- **Migrate to a true scale-to-zero Postgres (e.g. Neon).** Eliminates idle cost
  entirely but moves data off-GCP/out of the VPC and is a migration. Out of
  scope here; revisit only if always-on cost becomes a problem.

## Consequences

- Lower hourly cost whenever the instance is running.
- `db-f1-micro` has ~0.6 GB RAM: fewer concurrent connections and little buffer
  cache. Fine for a no-traffic app with two small databases (`cvmaker`,
  `admin`), but heavy queries or many connections will feel it. Size up the
  `tier` if the DB starts serving real load or hits memory pressure.
- **No SLA** — but `db-g1-small` was already a shared-core tier outside the Cloud
  SQL SLA, so this changes nothing on that front.
- The change is in Terraform (`infra/database.tf`) and takes effect on the next
  `terraform apply`, or the next time the instance is started after apply.
  Changing the machine type requires a restart, so apply it while the instance
  is stopped (its normal state) to avoid an extra restart.
