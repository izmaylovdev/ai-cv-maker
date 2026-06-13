# CI/CD identity — Workload Identity Federation so GitHub Actions can deploy to
# Cloud Run without long-lived service-account keys. See ADR-0006.

resource "google_project_service" "iamcredentials" {
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}

# Identity the GitHub workflow impersonates. Least-privilege for build+deploy:
# push images, roll Cloud Run services/jobs, and act as the runtime SAs.
resource "google_service_account" "github_deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer (CI/CD)"
}

resource "google_project_iam_member" "deployer_run_admin" {
  project = var.gcp_project_id
  role    = "roles/run.admin" # deploy/update Cloud Run services and execute jobs
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_project_iam_member" "deployer_ar_writer" {
  project = var.gcp_project_id
  role    = "roles/artifactregistry.writer" # push images
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_project_iam_member" "deployer_sa_user" {
  project = var.gcp_project_id
  role    = "roles/iam.serviceAccountUser" # actAs runtime SAs when deploying
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
  }

  # GCP requires a provider-level condition; restrict to this repo only.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  depends_on = [google_project_service.iamcredentials]
}

# Allow only this repo's tokens to impersonate the deployer SA.
resource "google_service_account_iam_member" "github_wif" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Values to set as GitHub Actions repo secrets (see ADR-0006 / DEPLOY.md).
output "github_wif_provider" {
  description = "Set as GitHub secret GCP_WORKLOAD_IDENTITY_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_sa" {
  description = "Set as GitHub secret GCP_SERVICE_ACCOUNT"
  value       = google_service_account.github_deployer.email
}
