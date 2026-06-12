# Secret Manager — runtime secret store for Cloud Run services.
# See doc/adr/0002-secret-management.md for the full decision record.
#
# Values still come from var.* (gitignored terraform.tfvars); Terraform creates
# the secret versions, and Cloud Run reads them via value_source/secret_key_ref
# so they never appear as plaintext env vars in the service spec.
#
# Access is least-privilege per secret: cv-api and llm-service use their
# dedicated SAs (network.tf); grafana and admin-api still run as the default
# compute SA, so their secrets are bound to that SA (follow-up in ADR-0002:
# give them dedicated SAs too).

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# Default compute SA — runtime identity of services without a dedicated SA.
data "google_project" "current" {}

locals {
  default_compute_sa = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

# ── cv-api secrets ─────────────────────────────────────────────────────────────

# Full Npgsql connection string (embeds the DB password). One secret instead of
# a separate password env var because ASP.NET Core consumes the connection
# string as a single value — no app changes needed (ADR-0002).
resource "google_secret_manager_secret" "cv_api_db_connection" {
  secret_id = "cv-api-db-connection"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "cv_api_db_connection" {
  secret      = google_secret_manager_secret.cv_api_db_connection.id
  secret_data = local.db_connection_string
}

resource "google_secret_manager_secret_iam_member" "cv_api_db_connection" {
  secret_id = google_secret_manager_secret.cv_api_db_connection.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cv_api.email}"
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "jwt-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = var.jwt_secret
}

resource "google_secret_manager_secret_iam_member" "jwt_secret" {
  secret_id = google_secret_manager_secret.jwt_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cv_api.email}"
}

resource "google_secret_manager_secret" "google_client_secret" {
  secret_id = "google-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "google_client_secret" {
  # Secret Manager rejects empty payloads; "unset" keeps the version creatable
  # when the optional var is not configured (same effect as empty for the app).
  secret_data = var.google_client_secret != "" ? var.google_client_secret : "unset"
  secret      = google_secret_manager_secret.google_client_secret.id
}

resource "google_secret_manager_secret_iam_member" "google_client_secret" {
  secret_id = google_secret_manager_secret.google_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cv_api.email}"
}

# ── llm-service secrets (LLM provider API keys) ────────────────────────────────

resource "google_secret_manager_secret" "google_api_key" {
  secret_id = "google-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "google_api_key" {
  secret      = google_secret_manager_secret.google_api_key.id
  secret_data = var.google_api_key != "" ? var.google_api_key : "unset"
}

resource "google_secret_manager_secret_iam_member" "google_api_key" {
  secret_id = google_secret_manager_secret.google_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_service.email}"
}

resource "google_secret_manager_secret" "openai_api_key" {
  secret_id = "openai-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "openai_api_key" {
  secret      = google_secret_manager_secret.openai_api_key.id
  secret_data = var.openai_api_key != "" ? var.openai_api_key : "unset"
}

resource "google_secret_manager_secret_iam_member" "openai_api_key" {
  secret_id = google_secret_manager_secret.openai_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_service.email}"
}

resource "google_secret_manager_secret" "foundry_api_key" {
  secret_id = "foundry-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "foundry_api_key" {
  secret      = google_secret_manager_secret.foundry_api_key.id
  secret_data = var.foundry_api_key != "" ? var.foundry_api_key : "unset"
}

resource "google_secret_manager_secret_iam_member" "foundry_api_key" {
  secret_id = google_secret_manager_secret.foundry_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_service.email}"
}

# ── shared / default-compute-SA secrets (grafana, admin-api) ───────────────────

resource "google_secret_manager_secret" "postgres_admin_password" {
  secret_id = "postgres-admin-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "postgres_admin_password" {
  secret      = google_secret_manager_secret.postgres_admin_password.id
  secret_data = var.postgres_admin_password
}

resource "google_secret_manager_secret_iam_member" "postgres_admin_password" {
  secret_id = google_secret_manager_secret.postgres_admin_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.default_compute_sa
}

resource "google_secret_manager_secret" "admin_jwt_secret" {
  secret_id = "admin-jwt-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "admin_jwt_secret" {
  secret      = google_secret_manager_secret.admin_jwt_secret.id
  secret_data = var.admin_jwt_secret
}

resource "google_secret_manager_secret_iam_member" "admin_jwt_secret" {
  secret_id = google_secret_manager_secret.admin_jwt_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.default_compute_sa
}

resource "google_secret_manager_secret" "grafana_admin_password" {
  secret_id = "grafana-admin-password"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "grafana_admin_password" {
  secret      = google_secret_manager_secret.grafana_admin_password.id
  secret_data = var.grafana_admin_password
}

resource "google_secret_manager_secret_iam_member" "grafana_admin_password" {
  secret_id = google_secret_manager_secret.grafana_admin_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.default_compute_sa
}
