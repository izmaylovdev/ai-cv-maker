# ADR-0011: Langfuse production hosting on a single GCE VM

- **Status:** Accepted (rollout gated — not yet deployed)
- **Date:** 2026-06-16

## Context

[ADR-0010](0010-langfuse-llm-observability.md) decided to adopt Langfuse for LLM
observability and to **self-host it on GCP** so that prompts/completions (user
career data) never leave our project. It deliberately left *how* to host the
self-hosted stack as a follow-up ops task, sketching "its own Cloud Run service
plus the datastores Langfuse requires".

Langfuse v3 is not a single container. A working deployment needs:

- `langfuse-web` and `langfuse-worker` (stateless app tier),
- **ClickHouse** (analytics store — stateful),
- **Redis** (queue — stateful),
- **S3-compatible blob storage** (MinIO — stateful),
- a Postgres metadata DB.

Three of these are stateful, and Cloud Run is a poor fit for stateful workloads.
The realistic hosting options were:

1. **Managed-per-service + GCE for ClickHouse** — web/worker on Cloud Run,
   Redis→Memorystore, blobs→GCS, Postgres→existing Cloud SQL, ClickHouse on a
   GCE VM. Cleanest fit with the existing Cloud-Run-only architecture, but the
   most moving parts and the most monthly cost (Memorystore alone is ~$35/mo).
2. **GKE Autopilot** — run the whole stack on Kubernetes. Best for stateful
   workloads, but introduces GKE into a project that is otherwise 100% Cloud Run,
   i.e. a large new operational surface for one stack.
3. **Single GCE VM running the docker-compose overlay** — lift-and-shift of the
   existing `docker-compose.langfuse.yml`. Cheapest and simplest; the tradeoff
   is a stateful "pet" VM outside the Cloud-Run + Terraform-per-service pattern.

This platform currently serves little/no traffic and is optimised for cost
(see [ADR-0008](0008-cloud-run-scale-to-zero.md), [ADR-0009](0009-smallest-db-tier.md)).
Observability is an internal, single-consumer concern (only `llm-service` writes
to it; only operators read it). High availability is not required.

## Decision

Host the production Langfuse stack on **a single Container/Docker GCE VM** that
runs `langfuse-web`, `langfuse-worker`, ClickHouse, Redis and MinIO via
docker-compose, provisioned by Terraform (`infra/langfuse.tf`).

The entire stack is **gated behind `var.langfuse_enabled` (default `false`)** so
it can be committed and validated without being deployed: with the flag off,
every Langfuse resource has `count = 0` and `llm-service` keeps its current shape
(no `vpc_access`, no `LANGFUSE_*` env), so `terraform apply` provisions nothing.
Going live is the single change `langfuse_enabled = true`. Concretely:

- **Compute:** one `e2-small` VM (2 GB RAM; overridable via
  `var.langfuse_vm_machine_type`) running Ubuntu LTS. A startup script installs
  Docker + the compose plugin, then brings up
  `monitoring/langfuse/docker-compose.prod.yml`. ClickHouse is memory-hungry; if
  it OOMs under real load, bump the machine type to `e2-medium` (4 GB) — it is a
  one-line variable change.
- **Persistence:** a separate persistent data disk (survives VM re-creation)
  holds the ClickHouse and MinIO docker volumes. The boot disk is disposable.
- **Metadata DB:** reuse the existing **Cloud SQL** instance
  ([ADR-0009](0009-smallest-db-tier.md)) with a new `langfuse` database; the VM
  reaches it on its private IP over VPC peering. No new database server.
- **Networking (privacy preserved):** the VM lives in a dedicated VPC subnet with
  **no inbound access from the internet**. A firewall rule allows ingress to the
  Langfuse port only from the Cloud Run egress subnet, plus IAP for SSH admin.
  The VM keeps an ephemeral external IP purely for *outbound* image pulls
  (cheaper than Cloud NAT); inbound from the internet is denied by the absence of
  any allow rule.
- **`llm-service` wiring:** `llm-service` gains Direct VPC egress with
  `egress = PRIVATE_RANGES_ONLY` so it can reach the VM's private IP **while
  keeping its direct-internet path to external LLM providers** (the reason it had
  no `vpc_access` before — see [ADR-0001](0001-llm-service-network-privacy.md)).
  `LANGFUSE_HOST` points at the VM's static internal IP; `LANGFUSE_PUBLIC_KEY`
  and `LANGFUSE_SECRET_KEY` come from Secret Manager ([ADR-0002](0002-secret-management.md)).
  With these set, tracing activates automatically (ADR-0010's opt-in/no-op design).

## Alternatives considered

- **Managed-per-service (option 1).** Rejected for now on cost and moving parts:
  Memorystore + extra Cloud Run services cost several times the VM for a no-HA
  internal tool. Revisit if Langfuse traffic or uptime needs grow.
- **GKE Autopilot (option 2).** Rejected: disproportionate operational surface
  (a whole new orchestrator) for one internal stack.
- **GCS instead of MinIO for blobs.** Would remove one stateful container, but
  the single-VM model already keeps state local; keeping MinIO makes the prod
  compose a near-mirror of the dev overlay. Revisit alongside option 1.

## Consequences

- **Easier / cheaper:** ~$13/mo (e2-small) for the whole observability backend;
  prod compose mirrors the dev overlay, so there is one stack to reason about.
- **Harder / new obligations:**
  - The VM is a **pet**: OS patching, Docker/Langfuse upgrades and ClickHouse
    health are manual. Mitigated by keeping all data on a separate disk so the VM
    itself is replaceable, and by scripting bring-up in the startup script.
  - **No HA / single point of failure** for observability. Acceptable: losing
    traces never affects user-facing requests (tracing is no-op-on-failure).
  - **Backups** are the data disk's responsibility (snapshot schedule — a further
    follow-up; not blocking).
  - VM-side secrets (ClickHouse/Redis/MinIO passwords, Langfuse encryption key)
    are delivered via instance metadata rendered by Terraform. They also live in
    Terraform state, which is the versioned, access-controlled GCS bucket
    (ADR-0002). The shared Langfuse API keys additionally live in Secret Manager
    because `llm-service` (Cloud Run) consumes them there.
- **Revisit if:** the stack outgrows one small VM, HA becomes a requirement, or
  manual upkeep outweighs the cost saving — at which point option 1 (managed) or
  option 2 (GKE) becomes worthwhile. Only `LANGFUSE_HOST` and the credentials
  change for `llm-service`, not its instrumentation (ADR-0010).
