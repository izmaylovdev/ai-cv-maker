output "app_url" {
  description = "Public URL of the Angular frontend."
  value       = google_cloud_run_v2_service.ui_angular.uri
}

output "ar_repository" {
  description = "Artifact Registry repository — use as image prefix when pushing."
  value       = local.ar_repository
}

output "postgres_host" {
  description = "Cloud SQL public IP address."
  value       = google_sql_database_instance.db.public_ip_address
}

output "grafana_url" {
  description = "Public URL of the Grafana dashboard."
  value       = google_cloud_run_v2_service.grafana.uri
}

output "admin_url" {
  description = "Public URL of the admin panel."
  value       = google_cloud_run_v2_service.admin_ui.uri
}

output "cv_api_url" {
  description = "Public URL of the CV API."
  value       = google_cloud_run_v2_service.cv_api.uri
}
