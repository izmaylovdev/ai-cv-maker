variable "prefix" {
  description = "Short prefix used in all resource names."
  type        = string
  default     = "aicvmaker"
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "westeurope"
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
