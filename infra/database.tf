resource "google_sql_database_instance" "db" {
  name             = "${var.project_name}-postgres"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier    = "db-g1-small"
    edition = "ENTERPRISE"

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

  deletion_protection = false

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.private_services,
  ]
}

resource "google_sql_database" "cvmaker" {
  name     = "cvmaker"
  instance = google_sql_database_instance.db.name
}

resource "google_sql_user" "cvmaker" {
  name     = var.postgres_admin_login
  instance = google_sql_database_instance.db.name
  password = var.postgres_admin_password
}

resource "google_sql_database" "admin" {
  name     = "admin"
  instance = google_sql_database_instance.db.name
}
