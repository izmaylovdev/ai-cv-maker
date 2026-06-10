# ── Global Application Load Balancer ───────────────────────────────────────────
#
# europe-central2 does not support Cloud Run domain mappings, so we route
# traffic through a global HTTPS LB with serverless NEGs instead.
#
# Domains served (same IP, host-based routing):
#   app.applysy.works   → ui-angular
#   admin.applysy.works → admin-ui

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

# --- SSL certificates (Google-managed) ----------------------------------------

resource "google_compute_managed_ssl_certificate" "app" {
  name = "app-applysy-works"

  managed {
    domains = ["app.applysy.works"]
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_managed_ssl_certificate" "admin" {
  name = "admin-applysy-works"

  managed {
    domains = ["admin.applysy.works"]
  }

  depends_on = [google_project_service.compute]
}

# --- Serverless NEGs ----------------------------------------------------------

resource "google_compute_region_network_endpoint_group" "ui_angular" {
  name                  = "ui-angular-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.ui_angular.name
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "admin_ui" {
  name                  = "admin-ui-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.admin_ui.name
  }

  depends_on = [google_project_service.compute]
}

# --- Backend services ---------------------------------------------------------

resource "google_compute_backend_service" "ui_angular" {
  name                  = "ui-angular-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30

  backend {
    group = google_compute_region_network_endpoint_group.ui_angular.id
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_backend_service" "admin_ui" {
  name                  = "admin-ui-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30

  backend {
    group = google_compute_region_network_endpoint_group.admin_ui.id
  }

  depends_on = [google_project_service.compute]
}

# --- URL map (host-based routing) ---------------------------------------------

resource "google_compute_url_map" "app" {
  name            = "app-applysy-works"
  default_service = google_compute_backend_service.ui_angular.id

  host_rule {
    hosts        = ["app.applysy.works"]
    path_matcher = "app"
  }

  host_rule {
    hosts        = ["admin.applysy.works"]
    path_matcher = "admin"
  }

  path_matcher {
    name            = "app"
    default_service = google_compute_backend_service.ui_angular.id
  }

  path_matcher {
    name            = "admin"
    default_service = google_compute_backend_service.admin_ui.id
  }
}

# --- HTTP → HTTPS redirect ----------------------------------------------------

resource "google_compute_url_map" "http_redirect" {
  name = "app-applysy-works-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "app-applysy-works-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "app-applysy-works-http"
  target                = google_compute_target_http_proxy.redirect.id
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.app.address
}

# --- HTTPS proxy + forwarding rule --------------------------------------------

resource "google_compute_target_https_proxy" "app" {
  name    = "app-applysy-works-https-proxy"
  url_map = google_compute_url_map.app.id
  ssl_certificates = [
    google_compute_managed_ssl_certificate.app.id,
    google_compute_managed_ssl_certificate.admin.id,
  ]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "app-applysy-works-https"
  target                = google_compute_target_https_proxy.app.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.app.address
}

# --- Static global IP ---------------------------------------------------------

resource "google_compute_global_address" "app" {
  name = "app-applysy-works-ip"

  depends_on = [google_project_service.compute]
}
