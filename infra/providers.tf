terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state in GCS (versioned, encrypted at rest, native locking).
  # The bucket is created once, manually — it cannot manage itself:
  #
  #   gcloud storage buckets create gs://applysy-tf-state \
  #     --project=applysy-498807 --location=europe-central2 \
  #     --uniform-bucket-level-access
  #   gcloud storage buckets update gs://applysy-tf-state --versioning
  #
  # Then migrate existing local state: terraform init -migrate-state
  # See DEPLOY.md ("Terraform remote state") and ADR-0002.
  backend "gcs" {
    bucket = "applysy-tf-state"
    prefix = "ai-cv-maker"
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.region
}
