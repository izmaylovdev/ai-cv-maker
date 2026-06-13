# ADR-0006: CI/CD deploys via Workload Identity Federation

- **Status:** Accepted
- **Date:** 2026-06-13

## Context

`.github/workflows/deploy.yml` builds images and deploys to Cloud Run on push
to `main`, authenticating with `google-github-actions/auth@v2` via
`workload_identity_provider` + `service_account` GitHub secrets. But the
workflow had **never succeeded**: it failed at the auth step in ~9s because the
required GitHub repo secrets (`GCP_WORKLOAD_IDENTITY_PROVIDER`,
`GCP_SERVICE_ACCOUNT`, `GCP_REGION`, `AR_REGISTRY`) were unset, and no Workload
Identity pool, provider, or deployer service account existed in GCP. Every
deploy was therefore manual. A second latent bug: the llm-service build step
used `apps/llm-service` as the Docker context, but that Dockerfile copies
`proto/llm_service.proto` and `apps/llm-service/...` from the repo root, so the
build would fail even once auth worked.

## Decision

Use **keyless Workload Identity Federation** (no long-lived SA keys), defined in
Terraform (`infra/cicd.tf`):

- A dedicated **`github-deployer`** service account with least-privilege deploy
  roles: `roles/run.admin` (roll services + execute the migrate job),
  `roles/artifactregistry.writer` (push images), `roles/iam.serviceAccountUser`
  (actAs the runtime SAs when deploying).
- A **Workload Identity Pool + OIDC provider** for
  `https://token.actions.githubusercontent.com`, with a provider-level
  `attribute_condition` restricting it to `assertion.repository ==
  "izmaylovdev/ai-cv-maker"`, and `roles/iam.workloadIdentityUser` granted only
  to that repo's `principalSet`.
- The four GitHub repo secrets are set from Terraform outputs
  (`github_wif_provider`, `github_deployer_sa`) plus the static region/registry.
- The llm-service build step is corrected to `-f apps/llm-service/Dockerfile .`
  (repo-root context).

The deployer SA does **not** get Terraform/infra-mutation permissions: CI only
builds images and rolls Cloud Run; infra changes (Secret Manager, IAM, SQL)
stay a deliberate manual `terraform apply` (ADR-0002/0003).

## Alternatives considered

- **Service-account JSON key in a GitHub secret:** rejected — long-lived
  exportable credential; WIF is the current Google-recommended keyless approach.
- **Owner-level condition (`repository_owner`):** rejected in favor of the
  exact repository, so a different repo under the same owner can't deploy.
- **Broad `roles/editor` on the deployer:** rejected — least-privilege; the
  three deploy roles are sufficient for build + Cloud Run rollout.
- **Run `terraform apply` from CI:** deferred — keeps infra changes reviewed
  and manual; revisit if drift between code and applied infra becomes a burden.

## Consequences

- Pushing to `main` now builds and deploys all services by git-SHA tag
  (ADR-0003) and runs the migrate job — deploys are no longer manual.
- The WIF provider and deployer SA are reproducible in Terraform; the only
  out-of-band step is setting the four GitHub secrets (documented in DEPLOY.md).
- CI cannot change infrastructure — an infra change still needs a manual
  `terraform apply` before/after the code deploy, or services may reference
  not-yet-created resources (as happened with the ADR-0005 admin-key cutover).
- If the repo is renamed/moved, the `github_repository` variable and the WIF
  binding must be updated.
