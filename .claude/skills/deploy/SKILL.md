---
description: Deploy the app to GCP by rebuilding and pushing changed Docker images, then updating Cloud Run services.
---

# Deploy

Redeploy changed services to GCP Cloud Run. Infrastructure is already provisioned via Terraform — this skill only handles image rebuilds and service updates.

## Prerequisites

- `gcloud` CLI authenticated: `gcloud auth print-identity-token` should succeed
- Docker running
- AR login: `gcloud auth configure-docker europe-central2-docker.pkg.dev`

If the GCP session is expired, run:
```bash
gcloud auth login
gcloud auth configure-docker europe-central2-docker.pkg.dev
```

## Detect which services changed

```bash
git diff --name-only HEAD | grep -E "^apps/" | cut -d'/' -f2 | sort -u
```

Also check if `infra/` changed — if so, run `terraform apply` (see below).

Services: `cv-api`, `ui-angular`, `chat-ui`, `llm-service`, `admin-api`, `admin-ui`

## Build & push changed images

Run only for services that changed. Images are built for `linux/amd64`.
**All builds use the repo root as the build context** (some Dockerfiles copy from `proto/` or `libs/`).

**cv-api** (.NET):
```bash
docker build --platform linux/amd64 -t europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/cv-api:latest \
  -f apps/cv-api/Dockerfile .
docker push europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/cv-api:latest
```

**ui-angular** (Angular + nginx):
```bash
docker build --platform linux/amd64 -t europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/ui-angular:latest \
  -f apps/ui-angular/Dockerfile .
docker push europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/ui-angular:latest
```

**chat-ui** (React web component):
```bash
docker build --platform linux/amd64 -t europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/chat-ui:latest \
  -f apps/chat-ui/Dockerfile .
docker push europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/chat-ui:latest
```

**llm-service** (Python/gRPC — build context must be repo root, not service dir, because it copies `proto/llm_service.proto`):
```bash
docker build --platform linux/amd64 -t europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/llm-service:latest \
  -f apps/llm-service/Dockerfile .
docker push europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/llm-service:latest
```

**admin-api** (NestJS):
```bash
docker build --platform linux/amd64 -t europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/admin-api:latest \
  -f apps/admin-api/Dockerfile .
docker push europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/admin-api:latest
```

**admin-ui** (Next.js):
```bash
docker build --platform linux/amd64 -t europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/admin-ui:latest \
  -f apps/admin-ui/Dockerfile .
docker push europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/admin-ui:latest
```

## Update Cloud Run services

Run only for services whose images were pushed. These can run in parallel.

```bash
gcloud run services update cv-api      --region europe-central2 --image europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/cv-api:latest
gcloud run services update ui-angular  --region europe-central2 --image europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/ui-angular:latest
gcloud run services update chat-ui     --region europe-central2 --image europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/chat-ui:latest
gcloud run services update llm-service --region europe-central2 --image europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/llm-service:latest
gcloud run services update admin-api   --region europe-central2 --image europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/admin-api:latest
gcloud run services update admin-ui    --region europe-central2 --image europe-central2-docker.pkg.dev/applysy-498807/aicvmaker/admin-ui:latest
```

Note: `gcloud run services update --image` always creates a new revision and re-pulls the image, even if the tag (`:latest`) hasn't changed. It is the correct way to deploy a newly pushed image.

## Apply infrastructure changes

If `infra/` changed (port config, scaling, env vars, ingress, etc.), run terraform after pushing images:

```bash
cd infra
terraform apply
```

If terraform fails because a Cloud Run revision fails its startup probe, fix the image first, repush, then re-run `terraform apply`. Do not skip — infra state will drift otherwise.

If terraform fails with "ssl_certificate resource is already being used", run:
```bash
terraform untaint google_compute_managed_ssl_certificate.app
```
Then re-run `terraform apply`.

After using `gcloud run services update` to work around a terraform failure, re-run `terraform apply` to sync state.

## Smoke tests

Run after every deployment (regardless of which service changed). All checks must pass before reporting success.

```bash
BASE="https://app.applysy.works"

check() {
  local desc=$1 url=$2 expected=$3
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url")
  if [ "$actual" = "$expected" ]; then
    echo "✓ $desc ($actual)"
  else
    echo "✗ $desc — expected $expected, got $actual"
    FAILED=1
  fi
}

FAILED=0
check "app shell loads"           "$BASE/"                            200
check "chat widget served"        "$BASE/chat-widget/chat-widget.js"  200
check "API proxy alive (401=ok)"  "$BASE/api/job-profiles"            401

if [ "$FAILED" = "1" ]; then
  echo ""
  echo "Smoke tests FAILED — investigate before marking deploy complete."
  exit 1
else
  echo ""
  echo "All smoke tests passed."
fi
```

Known issue: `chat-widget/chat-widget.js` may return 404 if the `chat-ui` image is stale. This is a pre-existing issue unrelated to llm-service or ui-angular deploys — only fail the deploy over it if `chat-ui` was explicitly changed.

If any check fails, inspect Cloud Run logs and service status:
```bash
gcloud run services describe <service> --region europe-central2
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=<service>" --limit 30 --format "table(timestamp,textPayload)"
```

App URL: `https://app.applysy.works`
Admin URL: `https://admin.applysy.works`

## Debugging gRPC (llm-service)

If cv-api logs show `RpcException: StatusCode="Unimplemented", Detail="Bad gRPC response. HTTP status code: 404"`:

1. Check llm-service Cloud Run logs — if **no logs appear at all** when cv-api makes calls, the requests are not reaching the container (ingress or routing issue), not a code bug.
2. Verify the port has `name = "h2c"` in `infra/apps.tf` — required for Cloud Run to forward HTTP/2 cleartext (gRPC) to the container.
3. Cloud Run v2 `INGRESS_TRAFFIC_INTERNAL_ONLY` is **VPC-only** — other Cloud Run services calling via `.run.app` URLs are blocked **unless the caller has Direct VPC egress** (`vpc_access` with `egress = "ALL_TRAFFIC"` on a subnet with Private Google Access). llm-service is INTERNAL_ONLY and cv-api egresses through the VPC; see `doc/adr/0001-llm-service-network-privacy.md`. Do not "fix" gRPC 404s by opening llm-service ingress.
4. If cv-api gets `PermissionDenied` / HTTP 403 from llm-service, the ID token is missing or the invoker IAM binding is wrong: cv-api must run with `LlmService__AuthMode=google` and its service account must hold `roles/run.invoker` on llm-service.

## Full infrastructure provisioning (first time only)

```bash
cd infra
terraform init
terraform apply
```
