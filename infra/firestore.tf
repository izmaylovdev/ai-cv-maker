# Cloud Firestore — the platform's only database (ADR-0021).
#
# Replaces the Cloud SQL Postgres instance. Firestore is a Google API reached
# over Private Google Access, so it needs no Cloud NAT and no VPC path, and it
# is authenticated by service-account IAM rather than a password — ADR-0001's
# network privacy stays intact and no database credential remains in Secret
# Manager.

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

# One database, in the same region as everything else.
#
# Name: Firestore's no-cost tier covers exactly ONE database per project, and it
# is claimed by the first database created — conventionally "(default)". Naming
# it anything else would forfeit the free tier, which is the entire point of
# ADR-0021, so the name is not a free choice.
#
# Location: europe-central2 (Warsaw) is a supported Firestore regional location
# and matches var.region, keeping cv-api ↔ database latency in-region. The
# no-cost quota (1 GiB stored, 50k reads / 20k writes / 20k deletes per day,
# 10 GiB/month egress) is not tied to any location, so co-locating costs
# nothing. A single region is not multi-region-durable; eur3 would be, at the
# price of cross-region latency and of leaving var.region behind.
#
# The API must be enabled before this resource can be created. As of 2026-08-16
# firestore.googleapis.com is NOT enabled on applysy-498807 — the
# google_project_service above is what enables it, on the first apply.
resource "google_firestore_database" "main" {
  project     = var.gcp_project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # This database holds every byte of application state. Both guards are
  # deliberate: delete_protection_state blocks deletion at the API (so console
  # and gcloud are covered too), deletion_policy = ABANDON makes a `terraform
  # destroy` drop the resource from state rather than delete the data.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"

  depends_on = [google_project_service.firestore]
}

# ── Per-service Firestore access ───────────────────────────────────────────────
#
# Firestore Native is authorised through the Datastore IAM roles.
# roles/datastore.user is read/write on documents only — it excludes
# roles/datastore.owner's ability to import, export or delete the database.
#
# Scope: the google provider (6.x) exposes no google_firestore_database_iam_*
# resource, so a project-level binding is the narrowest grant expressible here.
# That is not a practical widening: the free tier allows exactly one database,
# so "the project's Firestore" and "this database" are the same thing today.
# If a second database is ever added, tighten these into IAM Conditions on the
# database resource name.
#
# Only the two services that actually persist data are granted. Nothing is
# granted to the default compute SA, which would have handed Firestore access
# to grafana, prometheus and all four UI services at once.

resource "google_project_iam_member" "cv_api_datastore_user" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cv_api.email}"
}

# admin-api owns only the admin_users collection, but Firestore IAM has no
# collection-level granularity — document-level restriction would need Firestore
# Security Rules, which apply to client SDKs, not to server SDKs using ADC.
resource "google_project_iam_member" "admin_api_datastore_user" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.admin_api.email}"
}
