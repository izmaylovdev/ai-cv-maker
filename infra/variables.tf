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

variable "postgres_admin_login" {
  type    = string
  default = "cvmaker"
}

variable "postgres_admin_password" {
  type      = string
  sensitive = true
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
