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

## Verify

```bash
terraform -chdir=infra output app_url
```

App URL: `https://ui-angular.wonderfulisland-ff2d44e9.swedencentral.azurecontainerapps.io`

## Full infrastructure provisioning (first time only)

See `DEPLOY.md` for Terraform steps. Not needed for routine redeployments.