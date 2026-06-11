# Deployment Guide

End-to-end instructions for deploying AI CV Maker to GCP Cloud Run from scratch.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [gcloud CLI](https://cloud.google.com/sdk/docs/install) | ≥ 500 | `brew install google-cloud-sdk` |
| [Terraform](https://developer.hashicorp.com/terraform/install) | ≥ 1.7 | `brew install terraform` |
| [Docker](https://www.docker.com/products/docker-desktop/) | ≥ 25 | Docker Desktop |

---

## Step 1 — Authenticate with GCP

```bash
gcloud auth login
gcloud config set project applysy-498807
gcloud auth configure-docker europe-central2-docker.pkg.dev
```

Verify:

```bash
gcloud auth print-identity-token  # should succeed
```

---

## Step 2 — Configure Terraform variables

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Edit `infra/terraform.tfvars` and fill in all required values:

```hcl
gcp_project_id = "applysy-498807"
region         = "europe-central2"

postgres_admin_login    = "cvmaker"
postgres_admin_password = "<strong-password>"

jwt_secret                = "<random-string-at-least-32-chars>"
google_web_client_id      = "<client-id>.apps.googleusercontent.com"
google_extension_client_id = "<client-id>.apps.googleusercontent.com"
google_client_secret      = "<client-secret>"

# LLM provider — choose one section below
llm_provider = "google"   # google | openai | foundry
```

**For Google (Gemini):**
```hcl
llm_provider   = "google"
llm_model      = "gemini-2.0-flash"
google_api_key = "AIzaSy..."
```

**For OpenAI-compatible (LM Studio, OpenAI, etc.):**
```hcl
llm_provider    = "openai"
openai_base_url = "https://api.openai.com/v1"
openai_api_key  = "sk-..."
openai_model    = "gpt-4o"
```

**For Azure AI Foundry (Claude):**
```hcl
llm_provider            = "foundry"
foundry_api_key         = "<key-from-azure-portal>"
foundry_base_url        = "https://<resource>.services.ai.azure.com/anthropic"
foundry_deployment_name = "<deployment-name>"
```

---

## Step 3 — Provision infrastructure

```bash
cd infra
terraform init
terraform apply
cd ..
```

This provisions Cloud Run services, Artifact Registry, Cloud SQL (PostgreSQL), load balancer, and SSL certificates.

---

## Step 4 — Build and push container images

All images are built for `linux/amd64`. **All builds use the repo root as the build context** — some Dockerfiles reference `proto/` or `libs/` from the root.

```bash
AR="europe-central2-docker.pkg.dev/applysy-498807/aicvmaker"

# llm-service (Python/gRPC) — repo root required for proto/llm_service.proto
docker build --platform linux/amd64 -t $AR/llm-service:latest -f apps/llm-service/Dockerfile .
docker push $AR/llm-service:latest

# cv-api (.NET)
docker build --platform linux/amd64 -t $AR/cv-api:latest -f apps/cv-api/Dockerfile .
docker push $AR/cv-api:latest

# ui-angular (Angular + nginx)
docker build --platform linux/amd64 -t $AR/ui-angular:latest -f apps/ui-angular/Dockerfile .
docker push $AR/ui-angular:latest

# chat-ui (React web component)
docker build --platform linux/amd64 -t $AR/chat-ui:latest -f apps/chat-ui/Dockerfile .
docker push $AR/chat-ui:latest

# admin-api (NestJS)
docker build --platform linux/amd64 -t $AR/admin-api:latest -f apps/admin-api/Dockerfile .
docker push $AR/admin-api:latest

# admin-ui (Next.js)
docker build --platform linux/amd64 -t $AR/admin-ui:latest -f apps/admin-ui/Dockerfile .
docker push $AR/admin-ui:latest
```

---

## Step 5 — Deploy services

```bash
REGION="europe-central2"
AR="europe-central2-docker.pkg.dev/applysy-498807/aicvmaker"

gcloud run services update llm-service --region $REGION --image $AR/llm-service:latest
gcloud run services update cv-api      --region $REGION --image $AR/cv-api:latest
gcloud run services update ui-angular  --region $REGION --image $AR/ui-angular:latest
gcloud run services update chat-ui     --region $REGION --image $AR/chat-ui:latest
gcloud run services update admin-api   --region $REGION --image $AR/admin-api:latest
gcloud run services update admin-ui    --region $REGION --image $AR/admin-ui:latest
```

---

## Step 6 — Verify

Open https://app.applysy.works — the Angular UI should load and sign in via Google.

Quick smoke test:
```bash
BASE="https://app.applysy.works"
curl -s -o /dev/null -w "%{http_code}" "$BASE/"                   # 200
curl -s -o /dev/null -w "%{http_code}" "$BASE/api/job-profiles"   # 401
```

---

## Redeploying after code changes

Rebuild and push only the changed service, then update it:

```bash
AR="europe-central2-docker.pkg.dev/applysy-498807/aicvmaker"

docker build --platform linux/amd64 -t $AR/llm-service:latest -f apps/llm-service/Dockerfile .
docker push $AR/llm-service:latest
gcloud run services update llm-service --region europe-central2 --image $AR/llm-service:latest
```

If `infra/` also changed, run `terraform apply` after pushing images.

---

## Architecture notes

### gRPC (llm-service)

`llm-service` is a pure gRPC server (no HTTP). For it to work on Cloud Run:

- The port must have `name = "h2c"` in Terraform — tells Cloud Run to forward HTTP/2 cleartext to the container.
- Ingress must be `INGRESS_TRAFFIC_ALL` — Cloud Run v2 `INTERNAL_ONLY` means VPC-only; other Cloud Run services calling via `.run.app` URLs are treated as external and get 404.

### cv-api → llm-service communication

`cv-api` calls `llm-service` over gRPC using the Cloud Run service URL (`LlmService__GrpcUrl` env var, set by Terraform output). No VPC Connector is needed because llm-service ingress is open.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `gcloud auth print-identity-token` fails | GCP session expired | `gcloud auth login` |
| Docker push: `unauthorized` | AR not configured | `gcloud auth configure-docker europe-central2-docker.pkg.dev` |
| `RpcException: HTTP status code: 404` from cv-api | llm-service ingress or h2c misconfigured | Check `ingress = "INGRESS_TRAFFIC_ALL"` and `name = "h2c"` in `infra/apps.tf`; verify llm-service logs receive requests |
| Startup probe failed | Container not listening on declared port, or health servicer is sync in async server | Check `apps/llm-service/app/main.py` — health servicer `Check`/`Watch` must be `async def` |
| Terraform: ssl_certificate already in use | SSL cert tainted in state | `terraform untaint google_compute_managed_ssl_certificate.app` then re-apply |
| Terraform apply fails, then `gcloud run services update` used as workaround | State drift | Re-run `terraform apply` after the gcloud update to sync state |

---

## Teardown

```bash
cd infra
terraform destroy
```
