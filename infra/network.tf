# Project VPC for Cloud Run Direct VPC egress and Cloud SQL private IP.
# See doc/adr/0001-llm-service-network-privacy.md for the full decision record.

# compute.googleapis.com is already enabled in lb.tf

resource "google_project_service" "servicenetworking" {
  service            = "servicenetworking.googleapis.com"
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

# Reserved range + peering so Cloud SQL can get a private IP in this VPC.
resource "google_compute_global_address" "private_services" {
  name          = "${var.project_name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = "10.20.0.0"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]

  depends_on = [google_project_service.servicenetworking]
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

# Shared egress block values (Direct VPC egress, no serverless connector).
locals {
  vpc_egress_network    = google_compute_network.vpc.id
  vpc_egress_subnetwork = google_compute_subnetwork.cloudrun_egress.id
}
