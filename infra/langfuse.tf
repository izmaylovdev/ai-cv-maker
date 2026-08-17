# Production Langfuse stack on a single GCE VM (ADR-0011).
# Cheapest self-hosted topology: one VM runs the docker-compose Langfuse stack
# (web + worker + ClickHouse + Redis + MinIO); the metadata DB reuses Cloud SQL.
# The VM has no inbound internet access — only llm-service (via Direct VPC egress)
# and IAP can reach it.
#
# Rollout is gated behind var.langfuse_enabled (default false): the whole stack
# is committed and validated but creates NO resources until the flag is flipped,
# so it ships without deploying. Flip to true (terraform.tfvars) to go live.

locals {
  langfuse_count = var.langfuse_enabled ? 1 : 0
  langfuse_zone  = "${var.region}-a"
  # Stable internal address so llm-service's LANGFUSE_HOST never changes.
  langfuse_internal_ip = "10.30.0.10"
  # null when disabled (empty list); the prefixed key when enabled.
  langfuse_public_key = one([for r in random_id.langfuse_public_key : "pk-lf-${r.hex}"])
  langfuse_secret_key = one([for r in random_id.langfuse_secret_key : "sk-lf-${r.hex}"])
}

# ── Network: dedicated subnet so the VM's static IP can't collide with the
# Cloud Run egress subnet's dynamic allocation ───────────────────────────────
resource "google_compute_subnetwork" "langfuse" {
  count                    = local.langfuse_count
  name                     = "${var.project_name}-langfuse"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = "10.30.0.0/24"
  private_ip_google_access = true
}

# Ingress to the Langfuse port only from the Cloud Run egress subnet (where
# llm-service's Direct VPC egress traffic originates). No internet allow rule
# exists, so the ephemeral external IP is unreachable inbound.
resource "google_compute_firewall" "langfuse_ingress" {
  count     = local.langfuse_count
  name      = "${var.project_name}-langfuse-ingress"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["3000"]
  }

  source_ranges = [google_compute_subnetwork.cloudrun_egress.ip_cidr_range]
  target_tags   = ["langfuse"]
}

# IAP range for SSH admin (gcloud compute ssh --tunnel-through-iap).
resource "google_compute_firewall" "langfuse_iap_ssh" {
  count     = local.langfuse_count
  name      = "${var.project_name}-langfuse-iap-ssh"
  network   = google_compute_network.vpc.id
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["langfuse"]
}

# ── Metadata DB: externally provisioned (ADR-0021) ────────────────────────────
#
# This used to be `google_sql_database.langfuse`, a database on the shared Cloud
# SQL instance (ADR-0009). Cloud SQL is being deleted and Langfuse cannot run on
# Firestore, so the Postgres now has to come from somewhere else and is supplied
# through var.langfuse_postgres_* instead of being provisioned here. Nothing was
# lost in the process: langfuse_enabled has always been false, so this database
# was never actually created. This amends ADR-0010/0011/0012 to that extent.

# ── Generated credentials ────────────────────────────────────────────────────
# Langfuse API keys (shared with llm-service); the rest are VM-internal.
resource "random_id" "langfuse_public_key" {
  count       = local.langfuse_count
  byte_length = 16
}

resource "random_id" "langfuse_secret_key" {
  count       = local.langfuse_count
  byte_length = 24
}

# Langfuse ENCRYPTION_KEY must be exactly 256 bits as 64 hex chars.
resource "random_id" "langfuse_encryption_key" {
  count       = local.langfuse_count
  byte_length = 32
}

resource "random_password" "langfuse_salt" {
  count   = local.langfuse_count
  length  = 32
  special = false
}

resource "random_password" "langfuse_nextauth_secret" {
  count   = local.langfuse_count
  length  = 32
  special = false
}

resource "random_password" "langfuse_clickhouse" {
  count   = local.langfuse_count
  length  = 24
  special = false
}

resource "random_password" "langfuse_redis" {
  count   = local.langfuse_count
  length  = 24
  special = false
}

resource "random_password" "langfuse_minio" {
  count   = local.langfuse_count
  length  = 24
  special = false
}

# Initial Langfuse UI admin login password. Surfaced via `terraform output`
# (outputs.tf) so an operator can sign in; rotate it in the UI after first login.
resource "random_password" "langfuse_admin" {
  count   = local.langfuse_count
  length  = 20
  special = false
}

# ── Secret Manager: only the keys llm-service (Cloud Run) needs to read ───────
resource "google_secret_manager_secret" "langfuse_public_key" {
  count     = local.langfuse_count
  secret_id = "langfuse-public-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "langfuse_public_key" {
  count       = local.langfuse_count
  secret      = google_secret_manager_secret.langfuse_public_key[0].id
  secret_data = local.langfuse_public_key
}

resource "google_secret_manager_secret_iam_member" "langfuse_public_key" {
  count     = local.langfuse_count
  secret_id = google_secret_manager_secret.langfuse_public_key[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_service.email}"
}

resource "google_secret_manager_secret" "langfuse_secret_key" {
  count     = local.langfuse_count
  secret_id = "langfuse-secret-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "langfuse_secret_key" {
  count       = local.langfuse_count
  secret      = google_secret_manager_secret.langfuse_secret_key[0].id
  secret_data = local.langfuse_secret_key
}

resource "google_secret_manager_secret_iam_member" "langfuse_secret_key" {
  count     = local.langfuse_count
  secret_id = google_secret_manager_secret.langfuse_secret_key[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.llm_service.email}"
}

# ── The VM, its identity and its data disk ───────────────────────────────────
resource "google_service_account" "langfuse_vm" {
  count        = local.langfuse_count
  account_id   = "langfuse-vm"
  display_name = "Langfuse self-hosted VM"
}

# Persistent data disk: holds ClickHouse + MinIO volumes so they survive VM
# re-creation. Kept separate from the disposable boot disk (ADR-0011).
resource "google_compute_disk" "langfuse_data" {
  count = local.langfuse_count
  name  = "${var.project_name}-langfuse-data"
  type  = "pd-balanced"
  zone  = local.langfuse_zone
  size  = 20

  lifecycle {
    # Never let an apply destroy the observability data volume.
    prevent_destroy = true
  }
}

resource "google_compute_instance" "langfuse" {
  count        = local.langfuse_count
  name         = "${var.project_name}-langfuse"
  machine_type = var.langfuse_vm_machine_type
  zone         = local.langfuse_zone
  tags         = ["langfuse"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 20
    }
  }

  attached_disk {
    source      = google_compute_disk.langfuse_data[0].id
    device_name = "langfuse-data"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.langfuse[0].id
    network_ip = local.langfuse_internal_ip
    # Ephemeral external IP for outbound image pulls only; inbound is denied by
    # the absence of an internet allow rule (cheaper than Cloud NAT, ADR-0011).
    access_config {}
  }

  service_account {
    email  = google_service_account.langfuse_vm[0].email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = templatefile("${path.module}/langfuse-startup.sh.tftpl", {
    compose_yaml            = file("${path.module}/../monitoring/langfuse/docker-compose.prod.yml")
    data_dir                = "/opt/langfuse/data"
    postgres_host           = var.langfuse_postgres_host
    postgres_user           = var.langfuse_postgres_user
    postgres_password       = var.langfuse_postgres_password
    langfuse_public_key     = local.langfuse_public_key
    langfuse_secret_key     = local.langfuse_secret_key
    langfuse_salt           = random_password.langfuse_salt[0].result
    langfuse_encryption_key = random_id.langfuse_encryption_key[0].hex
    nextauth_secret         = random_password.langfuse_nextauth_secret[0].result
    # Operators reach the UI via IAP TCP forwarding to localhost:3000.
    nextauth_url        = "http://localhost:3000"
    clickhouse_password = random_password.langfuse_clickhouse[0].result
    redis_password      = random_password.langfuse_redis[0].result
    minio_root_password = random_password.langfuse_minio[0].result
    init_user_email     = var.langfuse_admin_email
    init_user_password  = random_password.langfuse_admin[0].result
  })

  lifecycle {
    # The startup script re-converges on boot; image patching is manual.
    ignore_changes = [boot_disk[0].initialize_params[0].image]

    # Fail the plan, not the boot. Without a Postgres the VM would come up, run
    # docker compose and leave Langfuse crash-looping on an unreachable DB —
    # the exact silent breakage ADR-0021 warns about when it drops the Cloud SQL
    # path. If the external Postgres is not on a private range reachable from
    # this subnet, the VM also needs egress to it.
    precondition {
      condition     = var.langfuse_postgres_host != "" && var.langfuse_postgres_user != "" && var.langfuse_postgres_password != ""
      error_message = "langfuse_enabled = true requires langfuse_postgres_host/user/password: Langfuse needs its own Postgres now that Cloud SQL is gone (ADR-0021)."
    }
  }
}
