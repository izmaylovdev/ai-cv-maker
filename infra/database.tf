# ⚠️  DECOMMISSIONED — retained, stopped, pending deletion (ADR-0021 §7).
#
# Nothing reads this instance any more: cv-api, admin-api and grafana are on
# Firestore (infra/firestore.tf) and every connection string, password secret
# and env var pointing here has been removed. It survives this commit for one
# reason only — to be the rollback target if the Firestore cutover has to be
# reversed while the data still matters.
#
# Stopped rather than deleted, and deleted rather than forgotten:
#
#   * activation_policy = "NEVER" is what actually saves the money. It stops the
#     instance on the next apply, so the ~$8/mo machine tier stops billing while
#     the ~$2/mo disk and backups keep the data. Making Terraform own the stop
#     is the specific fix for the ADR-0009 drift that caused ADR-0021: an
#     instance that was *documented* as stopped but had been RUNNABLE (and
#     billing) continuously, because stopping it was a manual step.
#   * The databases and the user below are kept too. Removing them from the
#     config would make Terraform DROP them on the next apply — the data would
#     be gone and the retention window would be worthless.
#   * Both deletion guards are on: deletion_protection stops Terraform, and
#     settings.deletion_protection_enabled stops gcloud and the console.
#
# TODO(ADR-0021, follow-up commit — after the rollback window closes):
#   delete this entire file, drop var.postgres_admin_login /
#   var.postgres_admin_password (kept only for google_sql_user below), remove
#   google_project_service.sqladmin from main.tf, and remove
#   google_compute_global_address.private_services +
#   google_service_networking_connection.private_services from network.tf —
#   the peering cannot go while this instance holds a private IP in the VPC.
#   Take a final export first; deletion also destroys the backups.
resource "google_sql_database_instance" "db" {
  name             = "${var.project_name}-postgres"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    # Smallest available tier (shared vCPU, ~0.6 GB RAM). Cost-minimal for a
    # no-traffic platform; not SLA-covered, but shared-core tiers never are, so
    # this loses nothing relative to db-g1-small (ADR-0009). Size up if the DB
    # starts serving real load or runs short on memory.
    tier    = "db-f1-micro"
    edition = "ENTERPRISE"

    # Stopped. Flip back to "ALWAYS" to restart it for a rollback.
    activation_policy = "NEVER"

    # Deletion guard cleared ahead of deleting this instance (ADR-0021,
    # 2026-10 amendment). Phase 1 of 2: apply this, then the next commit
    # removes the instance.
    deletion_protection_enabled = false

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
    }

    ip_configuration {
      # Public IP kept only for Cloud SQL Auth Proxy admin access; with no
      # authorized_networks it accepts no direct connections (ADR-0001).
      ipv4_enabled    = true
      private_network = google_compute_network.vpc.id
    }
  }

  # Cleared with the API-level guard above; Terraform refuses to destroy the
  # instance while this is true in state, so it has to be applied first.
  deletion_protection = false

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.private_services,
  ]
}

# Kept solely so Terraform does not drop the data during the rollback window.
# The `langfuse` database that also lived on this instance IS gone: ADR-0021
# drops the production Langfuse Postgres path outright, and that database was
# never created (var.langfuse_enabled has always been false).
resource "google_sql_database" "cvmaker" {
  name     = "cvmaker"
  instance = google_sql_database_instance.db.name
}

# Retained so a rollback can still authenticate. Nothing consumes this password
# any more — the postgres-admin-password Secret Manager secret and the cv-api
# connection-string secret are both removed (ADR-0021 §6).
resource "google_sql_user" "cvmaker" {
  name     = var.postgres_admin_login
  instance = google_sql_database_instance.db.name
  password = var.postgres_admin_password
}

resource "google_sql_database" "admin" {
  name     = "admin"
  instance = google_sql_database_instance.db.name
}
