output "app_url" {
  description = "Public URL of the Angular frontend (custom domain)."
  value       = "https://app.applysy.works"
}

output "dns_a_record" {
  description = "Create an A record in your DNS provider: app.applysy.works → <value>"
  value       = google_compute_global_address.app.address
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
  description = "Public URL of the admin panel (custom domain)."
  value       = "https://admin.applysy.works"
}

output "cv_api_url" {
  description = "Public URL of the CV API."
  value       = google_cloud_run_v2_service.cv_api.uri
}
