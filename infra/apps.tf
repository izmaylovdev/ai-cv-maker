locals {
  db_host              = google_sql_database_instance.db.public_ip_address
  db_connection_string = "Host=${local.db_host};Port=5432;Database=cvmaker;Username=${var.postgres_admin_login};Password=${var.postgres_admin_password};SslMode=Require"
}

# ── llm-service ────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "llm_service" {
  name     = "llm-service"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = "${local.ar_repository}/llm-service:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      ports {
        container_port = 50051
      }

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
      env {
        name  = "GOOGLE_API_KEY"
        value = var.google_api_key
      }
      env {
        name  = "OPENAI_BASE_URL"
        value = var.openai_base_url
      }
      env {
        name  = "OPENAI_API_KEY"
        value = var.openai_api_key
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }
      env {
        name  = "FOUNDRY_API_KEY"
        value = var.foundry_api_key
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

      startup_probe {
        tcp_socket {
          port = 50051
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 3
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_artifact_registry_repository.repo,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "llm_service_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.llm_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── cv-api ─────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "cv_api" {
  name     = "cv-api"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }

    containers {
      image = "${local.ar_repository}/cv-api:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      ports {
        container_port = 8080
      }

      env {
        name  = "ConnectionStrings__DefaultConnection"
        value = local.db_connection_string
      }
      env {
        name  = "JwtSettings__Secret"
        value = var.jwt_secret
      }
      env {
        name  = "LlmService__GrpcUrl"
        value = google_cloud_run_v2_service.llm_service.uri
      }
      env {
        name  = "Google__WebClientId"
        value = var.google_web_client_id
      }
      env {
        name  = "Google__ExtensionClientId"
        value = var.google_extension_client_id
      }
      env {
        name  = "Google__ClientSecret"
        value = var.google_client_secret
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 15
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        period_seconds    = 10
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.llm_service,
    google_sql_database_instance.db,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "cv_api_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.cv_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── chat-ui ────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "chat_ui" {
  name     = "chat-ui"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = "${local.ar_repository}/chat-ui:latest"

      resources {
        cpu_idle = true
        limits = {
          cpu    = "500m"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 80
      }
    }
  }

  depends_on = [google_project_service.run]
}

resource "google_cloud_run_v2_service_iam_member" "chat_ui_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.chat_ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── ui-angular ─────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "ui_angular" {
  name     = "ui-angular"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = "${local.ar_repository}/ui-angular:latest"

      resources {
        cpu_idle = true
        limits = {
          cpu    = "500m"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 80
      }

      env {
        name  = "CV_API_UPSTREAM"
        value = google_cloud_run_v2_service.cv_api.uri
      }
      env {
        name  = "CHAT_UI_UPSTREAM"
        value = google_cloud_run_v2_service.chat_ui.uri
      }
      env {
        name  = "NGINX_ENVSUBST_TEMPLATE_VARS"
        value = "CV_API_UPSTREAM CHAT_UI_UPSTREAM"
      }

      liveness_probe {
        http_get {
          path = "/"
          port = 80
        }
        initial_delay_seconds = 5
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/"
          port = 80
        }
        period_seconds    = 10
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.cv_api,
    google_cloud_run_v2_service.chat_ui,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "ui_angular_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.ui_angular.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── prometheus ─────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "prometheus" {
  name     = "prometheus"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = "${local.ar_repository}/prometheus:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 9090
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.cv_api,
    google_project_service.run,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "prometheus_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.prometheus.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── grafana ────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "grafana" {
  name     = "grafana"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    containers {
      image = "${local.ar_repository}/grafana:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 3000
      }

      env {
        name  = "GF_SECURITY_ADMIN_USER"
        value = var.grafana_admin_user
      }
      env {
        name  = "GF_SECURITY_ADMIN_PASSWORD"
        value = var.grafana_admin_password
      }
      env {
        name  = "GF_AUTH_ANONYMOUS_ENABLED"
        value = "false"
      }
      env {
        name  = "PROMETHEUS_URL"
        value = google_cloud_run_v2_service.prometheus.uri
      }
      env {
        name  = "POSTGRES_HOST"
        value = local.db_host
      }
      env {
        name  = "POSTGRES_PORT"
        value = "5432"
      }
      env {
        name  = "POSTGRES_DB"
        value = "cvmaker"
      }
      env {
        name  = "POSTGRES_USER"
        value = var.postgres_admin_login
      }
      env {
        name  = "POSTGRES_PASSWORD"
        value = var.postgres_admin_password
      }
      env {
        name  = "POSTGRES_SSL_MODE"
        value = "require"
      }

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 3000
        }
        initial_delay_seconds = 10
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 3000
        }
        period_seconds    = 10
        failure_threshold = 3
      }
    }
  }

  depends_on = [google_cloud_run_v2_service.prometheus]
}

resource "google_cloud_run_v2_service_iam_member" "grafana_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.grafana.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── admin-api ──────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "admin_api" {
  name     = "admin-api"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = "${local.ar_repository}/admin-api:latest"

      resources {
        cpu_idle = true
        limits = {
          cpu    = "500m"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 3000
      }

      env {
        name  = "DB_HOST"
        value = local.db_host
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_NAME"
        value = "cvmaker"
      }
      env {
        name  = "DB_USER"
        value = var.postgres_admin_login
      }
      env {
        name  = "DB_PASSWORD"
        value = var.postgres_admin_password
      }
      env {
        name  = "DB_SSL"
        value = "true"
      }
      env {
        name  = "ADMIN_DB_HOST"
        value = local.db_host
      }
      env {
        name  = "ADMIN_DB_PORT"
        value = "5432"
      }
      env {
        name  = "ADMIN_DB_NAME"
        value = "admin"
      }
      env {
        name  = "ADMIN_DB_USER"
        value = var.postgres_admin_login
      }
      env {
        name  = "ADMIN_DB_PASSWORD"
        value = var.postgres_admin_password
      }
      env {
        name  = "JWT_SECRET"
        value = var.admin_jwt_secret
      }
      env {
        name  = "GOOGLE_CLIENT_ID"
        value = var.google_web_client_id
      }
      env {
        name  = "ADMIN_SEED_EMAIL"
        value = var.admin_seed_email
      }

      liveness_probe {
        http_get {
          path = "/api"
          port = 3000
        }
        initial_delay_seconds = 10
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/api"
          port = 3000
        }
        period_seconds    = 10
        failure_threshold = 3
      }
    }
  }

  depends_on = [google_sql_database_instance.db]
}

resource "google_cloud_run_v2_service_iam_member" "admin_api_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.admin_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── admin-ui ───────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "admin_ui" {
  name     = "admin-ui"
  location = var.region
  deletion_protection = false
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = "${local.ar_repository}/admin-ui:latest"

      resources {
        cpu_idle = true
        limits = {
          cpu    = "500m"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 3000
      }

      env {
        name  = "ADMIN_API_URL"
        value = google_cloud_run_v2_service.admin_api.uri
      }
      env {
        name  = "GRAFANA_URL"
        value = google_cloud_run_v2_service.grafana.uri
      }

      liveness_probe {
        http_get {
          path = "/"
          port = 3000
        }
        initial_delay_seconds = 10
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/"
          port = 3000
        }
        period_seconds    = 10
        failure_threshold = 3
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_service.admin_api,
    google_cloud_run_v2_service.grafana,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "admin_ui_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.admin_ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
