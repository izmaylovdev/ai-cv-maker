variable "project_name" {
  description = "Base name used in all resource names."
  type        = string
  default     = "ai-cv-maker"
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "swedencentral"
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

variable "google_client_id" {
  type = string
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

# --- Azure AI Foundry (Claude) ---

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
