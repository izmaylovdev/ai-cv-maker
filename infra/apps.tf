locals {
  acr_server   = azurerm_container_registry.acr.login_server
  acr_username = azurerm_container_registry.acr.admin_username
  acr_password = azurerm_container_registry.acr.admin_password

  db_connection_string = "Host=${azurerm_postgresql_flexible_server.db.fqdn};Port=5432;Database=cvmaker;Username=${var.postgres_admin_login};Password=${var.postgres_admin_password};SslMode=Require"
}

resource "azurerm_container_app_environment" "env" {
  name                       = "${var.project_name}-env"
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

  dynamic "secret" {
    for_each = var.google_api_key != "" ? [var.google_api_key] : []
    content {
      name  = "google-api-key"
      value = secret.value
    }
  }

  dynamic "secret" {
    for_each = var.openai_api_key != "" ? [var.openai_api_key] : []
    content {
      name  = "openai-api-key"
      value = secret.value
    }
  }

  dynamic "secret" {
    for_each = var.foundry_api_key != "" ? [var.foundry_api_key] : []
    content {
      name  = "foundry-api-key"
      value = secret.value
    }
  }

  template {
    min_replicas = 0
    max_replicas = 2

    container {
      name   = "llm-service"
      image  = "${local.acr_server}/llm-service:latest"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "LLM_PROVIDER"
        value = var.llm_provider
      }
      env {
        name  = "LLM_MODEL"
        value = var.llm_model
      }
      env {
        name  = "LLM_TEMPERATURE"
        value = var.llm_temperature
      }

      dynamic "env" {
        for_each = var.google_api_key != "" ? [1] : []
        content {
          name        = "GOOGLE_API_KEY"
          secret_name = "google-api-key"
        }
      }

      env {
        name  = "OPENAI_BASE_URL"
        value = var.openai_base_url
      }
      dynamic "env" {
        for_each = var.openai_api_key != "" ? [1] : []
        content {
          name        = "OPENAI_API_KEY"
          secret_name = "openai-api-key"
        }
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }

      dynamic "env" {
        for_each = var.foundry_api_key != "" ? [1] : []
        content {
          name        = "FOUNDRY_API_KEY"
          secret_name = "foundry-api-key"
        }
      }
      env {
        name  = "FOUNDRY_BASE_URL"
        value = var.foundry_base_url
      }
      env {
        name  = "FOUNDRY_DEPLOYMENT_NAME"
        value = var.foundry_deployment_name
      }
      env {
        name  = "ANTHROPIC_FOUNDRY_MAX_TOKENS"
        value = var.anthropic_foundry_max_tokens
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8000
        path      = "/health"
        initial_delay          = 10
        interval_seconds       = 30
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8000
        path      = "/health"
        interval_seconds       = 10
        failure_count_threshold = 3
      }
    }
  }

  ingress {
    external_enabled = false
    target_port      = 50051
    transport        = "http2"
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
    min_replicas = 1
    max_replicas = 2

    container {
      name   = "cv-api"
      image  = "${local.acr_server}/cv-api:latest"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "ConnectionStrings__DefaultConnection"
        secret_name = "connection-string"
      }
      env {
        name        = "JwtSettings__Secret"
        secret_name = "jwt-secret"
      }
      env {
        name  = "LlmService__GrpcUrl"
        value = "http://llm-service"
      }
      env {
        name  = "Google__ClientId"
        value = var.google_client_id
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
        initial_delay          = 15
        interval_seconds       = 30
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/health"
        interval_seconds       = 10
        failure_count_threshold = 3
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  depends_on = [azurerm_container_app.llm_service]
}

# ── chat-ui ────────────────────────────────────────────────────────────────────

resource "azurerm_container_app" "chat_ui" {
  name                         = "chat-ui"
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
      name   = "chat-ui"
      image  = "${local.acr_server}/chat-ui:latest"
      cpu    = 0.25
      memory = "0.5Gi"
    }
  }

  ingress {
    external_enabled = false
    target_port      = 80
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
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

      # nginx template substitution: only replace these vars, leave $uri etc. intact
      env {
        name  = "CV_API_UPSTREAM"
        value = "https://${azurerm_container_app.cv_api.ingress[0].fqdn}"
      }
      env {
        name  = "CHAT_UI_UPSTREAM"
        value = "https://${azurerm_container_app.chat_ui.ingress[0].fqdn}"
      }
      env {
        name  = "NGINX_ENVSUBST_TEMPLATE_VARS"
        value = "CV_API_UPSTREAM CHAT_UI_UPSTREAM"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 80
        path      = "/"
        initial_delay          = 5
        interval_seconds       = 30
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 80
        path      = "/"
        interval_seconds       = 10
        failure_count_threshold = 3
      }
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

  depends_on = [azurerm_container_app.cv_api, azurerm_container_app.chat_ui]
}
