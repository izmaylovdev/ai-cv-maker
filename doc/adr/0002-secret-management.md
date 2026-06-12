# ADR-0002: Secret management for GCP infrastructure

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

A security review of `infra/` found three related problems with how secrets
are handled after the Azure → GCP migration (project `applysy-498807`,
region `europe-central2`):

1. **Plaintext env vars on Cloud Run.** Every sensitive value — the cv-api
   JWT secret, the Google OAuth client secret, the Postgres admin password
   (embedded in the cv-api connection string and passed directly to grafana
   and admin-api), the LLM provider API keys (Google/OpenAI/Foundry), the
   admin-api JWT secret, and the Grafana admin password — was injected via
   `env { value = var.* }` in `infra/apps.tf`. Plaintext env vars are
   readable by anyone with `run.services.get` (Cloud Console, `gcloud run
   services describe`) and are persisted verbatim in Terraform state.
2. **Local Terraform state.** State lived in `infra/terraform.tfstate` on a
   developer laptop: no locking, no versioning, no recovery if the disk is
   lost, and all of the above secrets sitting in a plaintext JSON file.
3. **Real-looking credentials tracked in git.** `apps/cv-api/appsettings.json`
   (tracked) contained a real local DB password and a fallback JWT secret.

Constraints: a solo-operated project with no CI/CD pipeline for Terraform;
secrets already exist as `var.*` values in the gitignored
`infra/terraform.tfvars`; cv-api reads its DB credentials only as a single
`ConnectionStrings__DefaultConnection` value (ASP.NET Core configuration —
there is no separate "password" knob without app code changes).

## Decision

1. **Google Secret Manager is the runtime secret store.** Each sensitive
   value gets a `google_secret_manager_secret` +
   `google_secret_manager_secret_version` pair (defined in
   `infra/secrets.tf`, values still sourced from `var.*` /
   `terraform.tfvars`). Cloud Run env blocks switch from `value = ...` to
   `value_source { secret_key_ref { ... } }` pinned to `version = "latest"`,
   so the values no longer appear in the service spec or the console.
2. **Least-privilege access per secret.** Each secret grants
   `roles/secretmanager.secretAccessor` only to the runtime service account
   of the service(s) that consume it: cv-api and llm-service use their
   dedicated SAs (ADR-0001); grafana and admin-api still run as the default
   compute SA, so their secrets are bound to that SA per-secret (no
   project-level grant). Giving grafana/admin-api dedicated SAs is a
   recorded follow-up.
3. **The DB connection string is itself the secret.** cv-api consumes one
   secret holding the full Npgsql connection string (host interpolated from
   the Cloud SQL resource, password from `var.postgres_admin_password`).
   This avoids changing cv-api configuration code; the password is never a
   standalone plaintext env var. grafana/admin-api take the password as its
   own secret-backed env var since their images already expect
   `POSTGRES_PASSWORD` / `DB_PASSWORD`.
4. **Terraform state moves to a versioned GCS bucket**
   (`applysy-tf-state`, `backend "gcs"` in `infra/providers.tf`). GCS
   encrypts at rest, supports native state locking, and object versioning
   gives state history. The bucket is created once, manually (it cannot
   manage itself); migration is `terraform init -migrate-state`
   (documented in `DEPLOY.md`). Secrets still appear inside the state
   blob — remote state reduces the blast radius (IAM-controlled, encrypted,
   versioned) rather than eliminating that property.
5. **No real credentials in tracked files.** `apps/cv-api/appsettings.json`
   keeps only obviously-fake placeholders; real local-dev values live in
   the gitignored `appsettings.Local.json` (loaded by `Program.cs`) or come
   from docker-compose env vars (`.env`, also gitignored).

## Alternatives considered

- **Status quo (plaintext env vars):** rejected — secrets readable in the
  console by any project viewer with Run access, and copied into every
  revision spec.
- **Per-credential secrets for cv-api (separate DB password env var):**
  rejected — ASP.NET Core composes the connection string as one value;
  splitting it requires app code to assemble Host/User/Password, more
  moving parts for zero additional secrecy.
- **Mounting secrets as volume files instead of env vars:** rejected —
  every consuming app currently reads env vars; file mounts would require
  app changes (or entrypoint shims) in four services.
- **Pinning secret versions (`version = "3"`) instead of `latest`:**
  more deterministic rollbacks, but every rotation would need a Terraform
  edit. With `latest`, rotation is `terraform apply` (new version) plus a
  redeploy. Acceptable for a solo project; revisit if rotation becomes
  frequent or multi-operator.
- **Terraform Cloud / S3-compatible backend for state:** rejected — the
  project is already all-in on GCP; a GCS bucket is zero new vendors and
  IAM-integrated.
- **Removing secrets from Terraform entirely (create secret versions by
  hand, Terraform only references them):** keeps secrets out of state, but
  splits the source of truth and makes `terraform apply` non-reproducible
  from `terraform.tfvars`. Rejected for now; this is the natural next step
  if state-borne secrets become a concern.

## Consequences

- New Terraform surface: `secretmanager.googleapis.com`, nine secrets +
  versions, per-secret IAM bindings, a `google_project` data source (to
  derive the default compute SA), and a GCS backend.
- Rotation procedure changes: update `terraform.tfvars`, `terraform apply`
  (creates a new secret version), then redeploy the consuming service so
  new instances resolve `latest`. Running instances keep the old value
  until replaced.
- Cloud Run deploys now fail fast if a referenced secret version is missing
  or the SA lacks access — a deliberate guardrail.
- Secrets remain present in Terraform state (now in GCS) and in the
  gitignored `terraform.tfvars` on the operator's machine. Accepted
  residual risk for a solo project.
- **Follow-ups:** (1) give grafana and admin-api dedicated service accounts
  so the default compute SA holds no secret access; (2) rotate every
  credential that was exposed as a plaintext env var or in git history
  (DB password, both JWT secrets, OAuth client secret, LLM API keys, Grafana
  admin password) — moving them does not un-leak them.
- Revisit if: a CI/CD pipeline appears (state access via workload identity,
  secrets out of tfvars), rotation cadence increases (consider pinned
  versions + automation), or secrets-in-state becomes unacceptable (manage
  versions outside Terraform).
