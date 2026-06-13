# ADR-0003: Migrations as a deploy step; SHA-pinned image deploys

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

Two coupled deployment-safety problems surfaced in the architecture review:

1. **Migrations ran on app startup.** `cv-api`'s `Program.cs` called
   `db.Database.Migrate()` unconditionally at boot. With `max_instance_count = 2`,
   two instances cold-starting after a deploy race the same DDL, and a failed
   migration turns into a crash-loop. Rollout was coupled to schema changes with
   no separation between "apply schema" and "serve traffic".

2. **Deploys were not reproducible.** Terraform set
   `image = "…/cv-api:latest"` while CI pushed both `:latest` and a
   `:<git-sha>` tag. A `terraform apply` after a CI deploy could silently roll a
   service back to whatever `:latest` resolved to, and rollback meant re-pushing
   tags rather than pointing at a known-good revision.

## Decision

1. **Migrations run as a dedicated Cloud Run job, not at startup.**
   - `cv-api` gains a CLI mode: `cv-api migrate` applies EF Core migrations and
     exits (0 on success, non-zero on failure) without starting the web host.
   - A `cv-api-migrate` Cloud Run **job** (`infra/apps.tf`) runs that mode with
     the cv-api service account, the same Direct VPC egress as the service (the
     DB is private-IP), and the DB connection string from Secret Manager.
   - CI executes `gcloud run jobs execute cv-api-migrate --wait` after pushing
     the image and **before** rolling out the new `cv-api` revision.
   - Startup migration is kept only behind a `RunMigrationsOnStartup` config
     flag (default **false**), which docker-compose sets to `true` so the local
     stack still self-migrates. Production never sets it.

2. **Deploys are pinned to the git SHA tag.**
   - CI deploys services and the migrate job with `…:<git-sha>`, never
     `:latest` (CI still pushes `:latest` for human convenience).
   - Every `google_cloud_run_v2_service` and the job carries
     `lifecycle { ignore_changes = [template[…].containers[0].image] }` so
     `terraform apply` does not revert the running image to the `:latest`
     placeholder. The `:latest` reference in Terraform is bootstrap-only —
     it sets the image for the first-ever apply, after which CI owns it.

## Alternatives considered

- **Keep startup migrations, set `max_instance_count = 1`:** rejected — caps
  throughput and still couples rollout to schema; a slow migration delays
  readiness and the first request.
- **Init container / pre-deploy hook in the service:** Cloud Run has no
  first-class init-container ordering for this; a job is the idiomatic
  one-shot primitive and is independently runnable/observable.
- **Pin Terraform to the SHA (pass via variable) instead of ignoring image
  drift:** rejected — would require threading the SHA into every `terraform
  apply` and make CI and Terraform fight over the same field. `ignore_changes`
  cleanly hands image ownership to CI while Terraform owns everything else.
- **Drop the `:latest` tag entirely:** rejected — harmless for humans doing
  manual `gcloud` pulls and keeps the bootstrap path simple.

## Consequences

- Deploys are reproducible and auditable: a revision maps to an exact commit.
- A failing migration fails the deploy at the job step, before any new revision
  serves traffic — no crash-loop, no half-migrated serving instances.
- Changing the image **must** go through CI (or a manual `gcloud run
  services/jobs update --image …:<tag>`); editing the image in Terraform has no
  effect on running services by design. The manual deploy flow is documented in
  the `deploy` skill.
- A schema change requires the migrate job to succeed first; if it fails, the
  old revision keeps serving — intended, but means a bad migration blocks the
  deploy until fixed/rolled back.
- Local dev is unchanged (docker-compose still migrates on startup).
