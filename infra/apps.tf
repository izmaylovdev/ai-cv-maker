locals {
  # Private IP — DB clients (cv-api, grafana, admin-api) reach it via Direct VPC egress.
  db_host = google_sql_database_instance.db.private_ip_address
  # Consumed only by the cv-api-db-connection secret version (secrets.tf);
  # cv-api reads it via secret_key_ref, never as a plaintext env var (ADR-0002).
  db_connection_string = "Host=${local.db_host};Port=5432;Database=cvmaker;Username=${var.postgres_admin_login};Password=${var.postgres_admin_password};SslMode=Require"
}

# ── llm-service ────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "llm_service" {
  name                = "llm-service"
  location            = var.region
  deletion_protection = false
  # INTERNAL_ONLY is reachable from cv-api because cv-api egresses through the
  # VPC (Direct VPC egress + Private Google Access). See ADR-0001.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    # No vpc_access here: llm-service calls external LLM providers
    # (OpenAI/Foundry are non-Google) and must keep the direct internet path.
    service_account = google_service_account.llm_service.email

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
        container_port = 8080
        name           = "h2c"
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
        name = "GOOGLE_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "OPENAI_BASE_URL"
        value = var.openai_base_url
      }
      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.openai_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }
      env {
        name = "FOUNDRY_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.foundry_api_key.secret_id
            version = "latest"
          }
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

      startup_probe {
        grpc {
          port    = 8080
          service = "llm.LlmService"
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
    # Cloud Run validates secret access when the revision is created.
    google_secret_manager_secret_version.google_api_key,
    google_secret_manager_secret_version.openai_api_key,
    google_secret_manager_secret_version.foundry_api_key,
    google_secret_manager_secret_iam_member.google_api_key,
    google_secret_manager_secret_iam_member.openai_api_key,
    google_secret_manager_secret_iam_member.foundry_api_key,
  ]

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "llm_service_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.llm_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cv_api.email}"
}

# ── cv-api ─────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "cv_api" {
  name                = "cv-api"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cv_api.email

    # ALL_TRAFFIC is required (not PRIVATE_RANGES_ONLY): the llm-service call
    # targets a .run.app URL, which only counts as internal traffic when it
    # leaves through the VPC. Google endpoints stay reachable via PGA;
    # any future non-Google egress from cv-api needs Cloud NAT (ADR-0001).
    vpc_access {
      network_interfaces {
        network    = local.vpc_egress_network
        subnetwork = local.vpc_egress_subnetwork
      }
      egress = "ALL_TRAFFIC"
    }

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
        name = "ConnectionStrings__DefaultConnection"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cv_api_db_connection.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JwtSettings__Secret"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "LlmService__GrpcUrl"
        value = google_cloud_run_v2_service.llm_service.uri
      }
      env {
        name  = "LlmService__AuthMode"
        value = "google"
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
        name = "Google__ClientSecret"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.google_client_secret.secret_id
            version = "latest"
          }
        }
      }
      # Shared key that authenticates admin-api's calls to /api/admin/* (ADR-0005).
      env {
        name = "AdminApi__ApiKey"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cv_api_admin_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "Cors__AllowedOrigins"
        value = "https://app.applysy.works"
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
    # Cloud Run validates secret access when the revision is created.
    google_secret_manager_secret_version.cv_api_db_connection,
    google_secret_manager_secret_version.jwt_secret,
    google_secret_manager_secret_version.google_client_secret,
    google_secret_manager_secret_version.cv_api_admin_key,
    google_secret_manager_secret_iam_member.cv_api_db_connection,
    google_secret_manager_secret_iam_member.jwt_secret,
    google_secret_manager_secret_iam_member.google_client_secret,
    google_secret_manager_secret_iam_member.cv_api_admin_key_cv_api,
  ]

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "cv_api_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.cv_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── cv-api-migrate (EF Core migrations as a deploy step) ────────────────────────
#
# Runs `cv-api migrate` exactly once per deploy instead of letting every service
# instance race db.Database.Migrate() at startup (ADR-0003). CI executes this job
# with --wait after pushing the image and before rolling out the cv-api service.
resource "google_cloud_run_v2_job" "cv_api_migrate" {
  name                = "cv-api-migrate"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.cv_api.email

      # The DB is private-IP; reach it through the same VPC egress as cv-api.
      vpc_access {
        network_interfaces {
          network    = local.vpc_egress_network
          subnetwork = local.vpc_egress_subnetwork
        }
        egress = "ALL_TRAFFIC"
      }

      max_retries = 1

      containers {
        image = "${local.ar_repository}/cv-api:latest"
        args  = ["migrate"]

        env {
          name = "ConnectionStrings__DefaultConnection"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.cv_api_db_connection.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # CI deploys the job by SHA tag; :latest here is bootstrap-only (ADR-0003).
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_sql_database_instance.db,
    google_secret_manager_secret_version.cv_api_db_connection,
    google_secret_manager_secret_iam_member.cv_api_db_connection,
  ]
}

# ── chat-ui ────────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "chat_ui" {
  name                = "chat-ui"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"

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

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
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
  name                = "ui-angular"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {

    # Direct VPC egress: reach the private-IP database and/or INTERNAL_ONLY
    # Cloud Run upstreams. Google-fronted endpoints are covered by PGA (ADR-0001).
    vpc_access {
      network_interfaces {
        network    = local.vpc_egress_network
        subnetwork = local.vpc_egress_subnetwork
      }
      egress = "ALL_TRAFFIC"
    }
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

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
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
  name                = "prometheus"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"

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

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
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
  name                = "grafana"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {

    # Direct VPC egress: reach the private-IP database and/or INTERNAL_ONLY
    # Cloud Run upstreams. Google-fronted endpoints are covered by PGA (ADR-0001).
    vpc_access {
      network_interfaces {
        network    = local.vpc_egress_network
        subnetwork = local.vpc_egress_subnetwork
      }
      egress = "ALL_TRAFFIC"
    }
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
        name = "GF_SECURITY_ADMIN_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.grafana_admin_password.secret_id
            version = "latest"
          }
        }
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
        name = "POSTGRES_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.postgres_admin_password.secret_id
            version = "latest"
          }
        }
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

  depends_on = [
    google_cloud_run_v2_service.prometheus,
    # Cloud Run validates secret access when the revision is created.
    google_secret_manager_secret_version.grafana_admin_password,
    google_secret_manager_secret_version.postgres_admin_password,
    google_secret_manager_secret_iam_member.grafana_admin_password,
    google_secret_manager_secret_iam_member.postgres_admin_password,
  ]

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
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
  name                = "admin-api"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {

    # Direct VPC egress: reach the private-IP database and/or INTERNAL_ONLY
    # Cloud Run upstreams. Google-fronted endpoints are covered by PGA (ADR-0001).
    vpc_access {
      network_interfaces {
        network    = local.vpc_egress_network
        subnetwork = local.vpc_egress_subnetwork
      }
      egress = "ALL_TRAFFIC"
    }
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

      # admin-api no longer touches the main DB — it reads user data from cv-api
      # (ADR-0005). cv-api's URL is a Google-fronted endpoint, reachable through
      # the existing Direct VPC egress + Private Google Access (no Cloud NAT).
      env {
        name  = "CV_API_URL"
        value = google_cloud_run_v2_service.cv_api.uri
      }
      env {
        name = "CV_API_ADMIN_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cv_api_admin_key.secret_id
            version = "latest"
          }
        }
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
        name = "ADMIN_DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.postgres_admin_password.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_jwt_secret.secret_id
            version = "latest"
          }
        }
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

  depends_on = [
    google_sql_database_instance.db,
    google_cloud_run_v2_service.cv_api,
    # Cloud Run validates secret access when the revision is created.
    # cv_api_admin_key → cv-api calls; postgres_admin_password → ADMIN_DB.
    google_secret_manager_secret_version.cv_api_admin_key,
    google_secret_manager_secret_version.postgres_admin_password,
    google_secret_manager_secret_version.admin_jwt_secret,
    google_secret_manager_secret_iam_member.cv_api_admin_key_admin_api,
    google_secret_manager_secret_iam_member.postgres_admin_password,
    google_secret_manager_secret_iam_member.admin_jwt_secret,
  ]

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
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
  name                = "admin-ui"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {

    # Direct VPC egress: reach the private-IP database and/or INTERNAL_ONLY
    # Cloud Run upstreams. Google-fronted endpoints are covered by PGA (ADR-0001).
    vpc_access {
      network_interfaces {
        network    = local.vpc_egress_network
        subnetwork = local.vpc_egress_subnetwork
      }
      egress = "ALL_TRAFFIC"
    }
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

  lifecycle {
    # CI owns the running image (deployed by SHA tag); :latest above is
    # bootstrap-only. Prevent terraform apply from reverting it (ADR-0003).
    ignore_changes = [template[0].containers[0].image]
  }
}

resource "google_cloud_run_v2_service_iam_member" "admin_ui_invoker" {
  project  = var.gcp_project_id
  location = var.region
  name     = google_cloud_run_v2_service.admin_ui.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
