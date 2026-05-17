locals {
  acr_server   = azurerm_container_registry.acr.login_server
  acr_username = azurerm_container_registry.acr.admin_username
  acr_password = azurerm_container_registry.acr.admin_password

  db_connection_string = "Host=${azurerm_postgresql_flexible_server.db.fqdn};Port=5432;Database=cvmaker;Username=${var.postgres_admin_login};Password=${var.postgres_admin_password};SslMode=Require"
}

resource "azurerm_container_app_environment" "env" {
  name                       = "${var.prefix}-env"
  resource_group_name        = azurerm_resource_group.rg.name
  location                   = azurerm_resource_group.rg.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id
}

# ── llm-service ────────────────────────────────────────────────────────────────

resource "azurerm_container_app" "llm_service" {
  name                         = "llm-service"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  registry {
    server               = local.acr_server
    username             = local.acr_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = local.acr_password
  }

  secret {
    name  = "google-api-key"
    value = var.google_api_key
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "llm-service"
      image  = "${local.acr_server}/llm-service:latest"
      cpu    = 0.5
      memory = "1Gi"

      env { name = "LLM_PROVIDER"; value = var.llm_provider }
      env { name = "LLM_MODEL";    value = var.llm_model }
      env { name = "GOOGLE_API_KEY"; secret_name = "google-api-key" }
    }
  }

  ingress {
    external_enabled = false
    target_port      = 8000
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}

# ── cv-api ─────────────────────────────────────────────────────────────────────

resource "azurerm_container_app" "cv_api" {
  name                         = "cv-api"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  registry {
    server               = local.acr_server
    username             = local.acr_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = local.acr_password
  }

  secret {
    name  = "connection-string"
    value = local.db_connection_string
  }

  secret {
    name  = "jwt-secret"
    value = var.jwt_secret
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "cv-api"
      image  = "${local.acr_server}/cv-api:latest"
      cpu    = 0.5
      memory = "1Gi"

      env { name = "ConnectionStrings__DefaultConnection"; secret_name = "connection-string" }
      env { name = "JwtSettings__Secret";                 secret_name = "jwt-secret" }
      env { name = "LlmService__BaseUrl"; value = "http://llm-service" }
      env { name = "Google__ClientId";   value = var.google_client_id }
    }
  }

  ingress {
    external_enabled = false
    target_port      = 8080
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  depends_on = [azurerm_container_app.llm_service]
}

# ── ui-angular ─────────────────────────────────────────────────────────────────

resource "azurerm_container_app" "ui_angular" {
  name                         = "ui-angular"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  registry {
    server               = local.acr_server
    username             = local.acr_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = local.acr_password
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "ui-angular"
      image  = "${local.acr_server}/ui-angular:latest"
      cpu    = 0.25
      memory = "0.5Gi"

      # nginx template substitution: only replace CV_API_UPSTREAM, leave $uri etc. intact
      env { name = "CV_API_UPSTREAM";              value = "http://cv-api" }
      env { name = "NGINX_ENVSUBST_TEMPLATE_VARS"; value = "CV_API_UPSTREAM" }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 80
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  depends_on = [azurerm_container_app.cv_api]
}
