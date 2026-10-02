# Project VPC for Cloud Run Direct VPC egress.
# See doc/adr/0001-llm-service-network-privacy.md for the full decision record.

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "vpc" {
  name                    = "${var.project_name}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.compute]
}

# Subnet used by Cloud Run services for Direct VPC egress.
# private_ip_google_access lets egressed traffic reach Google-fronted endpoints
# (.run.app, *.googleapis.com, OAuth) without a Cloud NAT gateway.
resource "google_compute_subnetwork" "cloudrun_egress" {
  name                     = "${var.project_name}-cloudrun-egress"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

# Per-service identities. llm-service's run.invoker is granted only to cv-api's
# service account — this is the IAM edge enforcement that replaces allUsers.
resource "google_service_account" "cv_api" {
  account_id   = "cv-api"
  display_name = "cv-api Cloud Run service"
}

resource "google_service_account" "llm_service" {
  account_id   = "llm-service"
  display_name = "llm-service Cloud Run service"
}

# admin-api ran as the default compute SA until ADR-0021. Firestore access is
# granted by IAM role rather than by a password, so leaving admin-api on the
# shared identity would have given roles/datastore.user to every service that
# still uses it — grafana, prometheus and all four UI services. A dedicated SA
# keeps the grant to the one service that needs it, and completes ADR-0002's
# own follow-up for admin-api. grafana is the last holdout.
resource "google_service_account" "admin_api" {
  account_id   = "admin-api"
  display_name = "admin-api Cloud Run service"
}

# Shared egress block values (Direct VPC egress, no serverless connector).
locals {
  vpc_egress_network    = google_compute_network.vpc.id
  vpc_egress_subnetwork = google_compute_subnetwork.cloudrun_egress.id
}
