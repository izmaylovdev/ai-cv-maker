variable "gcp_project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "project_name" {
  description = "Base name used in resource names."
  type        = string
  default     = "ai-cv-maker"
}

variable "region" {
  description = "GCP region for all resources."
  type        = string
  default     = "us-central1"
}

# Firestore database location (ADR-0021). Defaults to the app region; Warsaw is
# a supported Firestore regional location and the no-cost tier is not tied to
# any particular one. Changing this after creation forces a new database, which
# the delete protection in firestore.tf will (deliberately) refuse.
variable "firestore_location" {
  type    = string
  default = "europe-central2"
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "google_web_client_id" {
  type = string
}

variable "google_extension_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "google_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "llm_provider" {
  type    = string
  default = "google"
}

variable "llm_model" {
  type    = string
  default = ""
}

variable "llm_temperature" {
  type    = string
  default = "0.4"
}

# --- OpenAI-compatible (LM Studio, local, etc.) ---

variable "openai_base_url" {
  type    = string
  default = ""
}

variable "openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "openai_model" {
  type    = string
  default = ""
}

# --- Anthropic (Claude direct API) ---
# anthropic_api_key secret value is managed out-of-band in Secret Manager
# (see infra/secrets.tf), not via a tfvar.

# --- Azure AI Foundry (Claude via Foundry) ---

variable "foundry_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "foundry_base_url" {
  type    = string
  default = ""
}

variable "foundry_deployment_name" {
  type    = string
  default = ""
}

variable "anthropic_foundry_max_tokens" {
  type    = string
  default = "8192"
}

variable "grafana_admin_user" {
  type    = string
  default = "admin"
}

variable "grafana_admin_password" {
  type      = string
  sensitive = true
}

variable "admin_jwt_secret" {
  type      = string
  sensitive = true
}

# Shared API key admin-api sends to cv-api's GET /api/admin/users (ADR-0005).
# Same value reaches cv-api (AdminApi__ApiKey) and admin-api (CV_API_ADMIN_KEY)
# via the cv-api-admin-key secret.
variable "cv_api_admin_key" {
  type      = string
  sensitive = true
}

variable "admin_seed_email" {
  type    = string
  default = ""
}

# GitHub repo (owner/name) allowed to deploy via Workload Identity Federation (ADR-0006).
variable "github_repository" {
  type    = string
  default = "izmaylovdev/ai-cv-maker"
}

# --- Langfuse self-hosted VM (ADR-0011) ---

# Master switch for the prod Langfuse stack. Default false: the config is
# committed and validated but provisions nothing, so it ships without deploying.
# Set true (terraform.tfvars) to go live — this is the only change needed.
variable "langfuse_enabled" {
  type    = bool
  default = false
}

# e2-small (2 GB) is the cheapest size that fits the whole stack. ClickHouse is
# memory-hungry; bump to e2-medium (4 GB) if it OOMs under real load.
variable "langfuse_vm_machine_type" {
  type    = string
  default = "e2-small"
}

# Email for the initial Langfuse UI admin user (auto-provisioned on first boot).
variable "langfuse_admin_email" {
  type    = string
  default = "admin@applysy.works"
}

# Langfuse metadata Postgres — externally provisioned (ADR-0021).
#
# Langfuse hard-requires Postgres and cannot run on Firestore. Its metadata DB
# used to be a database on the shared Cloud SQL instance; that instance is being
# deleted, so re-enabling Langfuse in production now means provisioning a
# Postgres for it first (a Neon free project serves this well) and supplying it
# here. The empty defaults are safe because langfuse_enabled is false; the
# precondition in langfuse.tf fails the plan if it is turned on without these.
#
# Unrelated to local evals: `npm run evals` uses the docker-compose Langfuse
# overlay and its own containerised Postgres.
variable "langfuse_postgres_host" {
  type    = string
  default = ""
}

variable "langfuse_postgres_user" {
  type    = string
  default = ""
}

variable "langfuse_postgres_password" {
  type      = string
  sensitive = true
  default   = ""
}
