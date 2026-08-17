output "app_url" {
  description = "Public URL of the Angular frontend (custom domain)."
  value       = "https://app.applysy.works"
}

output "landing_url" {
  description = "Public URL of the marketing landing page (apex domain)."
  value       = "https://applysy.works"
}

output "ar_repository" {
  description = "Artifact Registry repository — use as image prefix when pushing."
  value       = local.ar_repository
}

output "firestore_database" {
  description = "Firestore database resource name (Native mode, free-tier default)."
  value       = google_firestore_database.main.name
}

output "firestore_location" {
  description = "Firestore database location."
  value       = google_firestore_database.main.location_id
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

# ── Langfuse (ADR-0011) — null until var.langfuse_enabled = true ──────────────

output "langfuse_internal_url" {
  description = "Internal URL llm-service uses to reach Langfuse (in-VPC only)."
  value       = var.langfuse_enabled ? "http://${local.langfuse_internal_ip}:3000" : null
}

output "langfuse_ssh" {
  description = "Open the Langfuse UI: SSH-tunnel via IAP, then browse http://localhost:3000."
  value       = var.langfuse_enabled ? "gcloud compute ssh ${var.project_name}-langfuse --zone ${local.langfuse_zone} --tunnel-through-iap -- -L 3000:localhost:3000" : null
}

output "langfuse_admin_email" {
  description = "Initial Langfuse UI admin login email."
  value       = var.langfuse_enabled ? var.langfuse_admin_email : null
}

output "langfuse_admin_password" {
  description = "Initial Langfuse UI admin password — rotate after first login."
  value       = one(random_password.langfuse_admin[*].result)
  sensitive   = true
}
