---
description: Deploy the app to Azure by rebuilding and pushing changed Docker images, then updating the container apps.
---

# Deploy

Redeploy changed services to Azure Container Apps. Infrastructure is already provisioned via Terraform — this skill only handles image rebuilds and container app updates.

## Prerequisites

- Azure CLI logged in: `az account show` should return the `personal` subscription
- Docker running
- ACR login: `az acr login --name aicvmakeracr`

If the Azure session is expired, run:
```bash
az login
az acr login --name aicvmakeracr
```

## Detect which services changed

```bash
git diff --name-only HEAD | grep -E "^apps/" | cut -d'/' -f2 | sort -u
```

Services: `cv-api`, `ui-angular`, `llm-service`

## Build & push changed images

Run only for services that changed. Images are built for `linux/amd64`.

**cv-api** (.NET 9, build context is repo root):
```bash
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/cv-api:latest \
  -f apps/cv-api/Dockerfile .
docker push aicvmakeracr.azurecr.io/cv-api:latest
```

**ui-angular** (Angular + nginx, build context is repo root):
```bash
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/ui-angular:latest \
  -f apps/ui-angular/Dockerfile .
docker push aicvmakeracr.azurecr.io/ui-angular:latest
```

**llm-service** (Python/gRPC, build context is the service dir):
```bash
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/llm-service:latest \
  -f apps/llm-service/Dockerfile apps/llm-service
docker push aicvmakeracr.azurecr.io/llm-service:latest
```

## Update container apps

Run only for services whose images were pushed. These can run in parallel.

```bash
az containerapp update --name cv-api      --resource-group rg-ai-cv-maker --image aicvmakeracr.azurecr.io/cv-api:latest
az containerapp update --name ui-angular  --resource-group rg-ai-cv-maker --image aicvmakeracr.azurecr.io/ui-angular:latest
az containerapp update --name llm-service --resource-group rg-ai-cv-maker --image aicvmakeracr.azurecr.io/llm-service:latest
```

## Smoke tests

Run after every deployment (regardless of which service changed). All checks must pass before reporting success.

```bash
BASE="https://ui-angular.wonderfulisland-ff2d44e9.swedencentral.azurecontainerapps.io"

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
check "app shell loads"            "$BASE/"                              200
check "chat widget served"         "$BASE/chat-widget/chat-widget.js"   200
check "API proxy alive (401=ok)"   "$BASE/api/job-profiles"             401

if [ "$FAILED" = "1" ]; then
  echo ""
  echo "Smoke tests FAILED — investigate before marking deploy complete."
  exit 1
else
  echo ""
  echo "All smoke tests passed."
fi
```

If any check fails, inspect nginx logs and container status before declaring the deploy done:
```bash
az containerapp logs show --name ui-angular --resource-group rg-ai-cv-maker --tail 30
az containerapp show --name ui-angular --resource-group rg-ai-cv-maker --query "properties.runningStatus"
```

App URL: `https://ui-angular.wonderfulisland-ff2d44e9.swedencentral.azurecontainerapps.io`

## Full infrastructure provisioning (first time only)

See `DEPLOY.md` for Terraform steps. Not needed for routine redeployments.