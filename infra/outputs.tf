output "app_url" {
  description = "Public URL of the Angular frontend."
  value       = "https://${azurerm_container_app.ui_angular.ingress[0].fqdn}"
}

output "acr_login_server" {
  description = "ACR login server — set as ACR_LOGIN_SERVER in GitHub secrets."
  value       = azurerm_container_registry.acr.login_server
}

output "acr_name" {
  description = "ACR resource name — set as ACR_NAME in GitHub secrets."
  value       = azurerm_container_registry.acr.name
}

output "resource_group" {
  description = "Resource group name — set as RESOURCE_GROUP in GitHub secrets."
  value       = azurerm_resource_group.rg.name
}

output "postgres_fqdn" {
  description = "PostgreSQL server hostname."
  value       = azurerm_postgresql_flexible_server.db.fqdn
}
