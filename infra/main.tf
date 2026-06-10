locals {
  ar_repository = "${var.region}-docker.pkg.dev/${var.gcp_project_id}/${replace(var.project_name, "-", "")}"
}

# Enable required GCP APIs
resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sqladmin" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Artifact Registry repository (replaces ACR)
resource "google_artifact_registry_repository" "repo" {
  repository_id = replace(var.project_name, "-", "")
  location      = var.region
  format        = "DOCKER"

  depends_on = [google_project_service.artifactregistry]
}
