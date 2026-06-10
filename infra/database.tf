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
      ipv4_enabled = true
      # Cloud Run services connect via public IP with SSL
      authorized_networks {
        name  = "all"
        value = "0.0.0.0/0"
      }
    }
  }

  deletion_protection = false

  depends_on = [google_project_service.sqladmin]
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
