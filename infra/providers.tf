terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Uncomment to use GCS as remote backend:
  # backend "gcs" {
  #   bucket = "your-tfstate-bucket"
  #   prefix = "ai-cv-maker"
  # }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.region
}
