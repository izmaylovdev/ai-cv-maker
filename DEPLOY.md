# Deployment Guide

End-to-end instructions for deploying AI CV Maker to Azure from scratch.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) | ≥ 2.60 | `brew install azure-cli` |
| [Terraform](https://developer.hashicorp.com/terraform/install) | ≥ 1.7 | `brew install terraform` |
| [Docker](https://www.docker.com/products/docker-desktop/) | ≥ 25 | Docker Desktop |

---

## Step 1 — Authenticate with Azure

```bash
az login --tenant "<your-tenant-id>"
az account set --subscription "<your-subscription-id>"
```

Verify the correct subscription is active:

```bash
az account show --query "{name:name, id:id}" -o table
```

---

## Step 2 — Configure Terraform variables

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Edit `infra/terraform.tfvars` and fill in all required values:

```hcl
project_name = "ai-cv-maker"       # used in all Azure resource names
location     = "swedencentral"     # Azure region

postgres_admin_login    = "cvmaker"
postgres_admin_password = "<strong-password>"

jwt_secret       = "<random-string-at-least-32-chars>"
google_client_id = "<your-client-id>.apps.googleusercontent.com"

# LLM provider — choose one section below and set llm_provider accordingly
llm_provider = "foundry"           # google | openai | foundry
```

**For Google (Gemini):**
```hcl
llm_provider   = "google"
google_api_key = "AIzaSy..."
# llm_model    = "gemini-1.5-flash"
```

**For Azure AI Foundry (Claude):**
```hcl
llm_provider            = "foundry"
foundry_api_key         = "<key-from-azure-portal>"
foundry_base_url        = "https://<resource>.services.ai.azure.com/anthropic"
foundry_deployment_name = "<deployment-name>"
# llm_model             = "claude-haiku-4-5"
```

**For OpenAI-compatible (LM Studio, etc.):**
```hcl
llm_provider    = "openai"
openai_base_url = "http://127.0.0.1:1234/v1"
openai_api_key  = "lm-studio"
openai_model    = "local-model"
```

---

## Step 3 — Register Azure resource providers

These only need to be registered once per subscription:

```bash
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.DBforPostgreSQL --wait
az provider register --namespace Microsoft.ContainerRegistry --wait
az provider register --namespace Microsoft.OperationalInsights --wait
```

---

## Step 4 — Provision infrastructure

```bash
cd infra
terraform init
```

Deploy everything **except** the container apps (images don't exist yet):

```bash
terraform apply \
  -target=azurerm_resource_group.rg \
  -target=azurerm_log_analytics_workspace.law \
  -target=azurerm_container_registry.acr \
  -target=azurerm_postgresql_flexible_server.db \
  -target=azurerm_postgresql_flexible_server_database.cvmaker \
  -target=azurerm_postgresql_flexible_server_firewall_rule.azure_services \
  -target=azurerm_container_app_environment.env
cd ..
```

---

## Step 5 — Build and push container images

Log in to the ACR that was just created:

```bash
az acr login --name aicvmakeracr
```

> The ACR name is `${project_name}acr` with hyphens removed. With the default `project_name = "ai-cv-maker"` it is `aicvmakeracr`.
> Run `terraform -chdir=infra output acr_login_server` to get the exact value.

Build and push all three services:

```bash
# llm-service (Python / gRPC)
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/llm-service:latest \
  -f apps/llm-service/Dockerfile apps/llm-service
docker push aicvmakeracr.azurecr.io/llm-service:latest

# cv-api (.NET 9)
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/cv-api:latest \
  -f apps/cv-api/Dockerfile .
docker push aicvmakeracr.azurecr.io/cv-api:latest

# ui-angular (Angular + nginx)
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/ui-angular:latest \
  -f apps/ui-angular/Dockerfile .
docker push aicvmakeracr.azurecr.io/ui-angular:latest
```

---

## Step 6 — Deploy container apps

```bash
terraform -chdir=infra apply
```

This creates the three Container Apps using the images pushed in the previous step.

---

## Step 7 — Verify

```bash
terraform -chdir=infra output app_url
```

Open the printed URL in a browser. The Angular UI should load and be able to sign in via Google.

---

## Redeploying after code changes

Rebuild and push only the changed service, then restart its Container App revision:

```bash
# Example: redeploy llm-service
docker build --platform linux/amd64 -t aicvmakeracr.azurecr.io/llm-service:latest \
  -f apps/llm-service/Dockerfile apps/llm-service
docker push aicvmakeracr.azurecr.io/llm-service:latest

az containerapp update \
  --name llm-service \
  --resource-group rg-ai-cv-maker \
  --image aicvmakeracr.azurecr.io/llm-service:latest
```

Repeat with `cv-api` or `ui-angular` as needed. No `terraform apply` required for image-only updates.

---

## Importing existing Azure resources into Terraform state

If resources already exist in Azure (created manually or by a previous run), import them before applying.
Replace `<sub-id>` with your subscription ID (`az account show --query id -o tsv`).

```bash
# Resource group
terraform -chdir=infra import azurerm_resource_group.rg \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker

# Log Analytics workspace
terraform -chdir=infra import azurerm_log_analytics_workspace.law \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.OperationalInsights/workspaces/ai-cv-maker-law

# Container Registry
terraform -chdir=infra import azurerm_container_registry.acr \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.ContainerRegistry/registries/aicvmakeracr

# PostgreSQL server
terraform -chdir=infra import azurerm_postgresql_flexible_server.db \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.DBforPostgreSQL/flexibleServers/ai-cv-maker-postgres

# PostgreSQL database
terraform -chdir=infra import azurerm_postgresql_flexible_server_database.cvmaker \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.DBforPostgreSQL/flexibleServers/ai-cv-maker-postgres/databases/cvmaker

# PostgreSQL firewall rule
terraform -chdir=infra import azurerm_postgresql_flexible_server_firewall_rule.azure_services \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.DBforPostgreSQL/flexibleServers/ai-cv-maker-postgres/firewallRules/AllowAzureServices

# Container App environment
terraform -chdir=infra import azurerm_container_app_environment.env \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.App/managedEnvironments/ai-cv-maker-env

# Container Apps
terraform -chdir=infra import azurerm_container_app.llm_service \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.App/containerApps/llm-service

terraform -chdir=infra import azurerm_container_app.cv_api \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.App/containerApps/cv-api

terraform -chdir=infra import azurerm_container_app.ui_angular \
  /subscriptions/<sub-id>/resourceGroups/rg-ai-cv-maker/providers/Microsoft.App/containerApps/ui-angular
```

---

## Teardown

```bash
terraform -chdir=infra destroy
```

> Any resources inside the resource group that were **not** created by Terraform (e.g. Azure AI Foundry accounts) will block RG deletion. Delete them manually in the Azure Portal first, or remove them from the resource group before running destroy.

---

## Architecture notes

### cv-api external ingress

`cv-api` is deployed with `external_enabled = true` even though it is only called by the nginx proxy inside the same Container Apps environment. The reason is that Azure Container Apps internal FQDNs (`*.internal.*`) redirect plain HTTP to HTTPS, and their managed TLS certificates are not compatible with nginx's upstream SSL handshake — nginx gets a TCP RST during the ClientHello. The external FQDN uses Azure's standard managed certificate, which nginx can connect to normally. All sensitive cv-api routes require a valid JWT, so public exposure is acceptable.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `AADSTS700082: refresh token expired` | Azure CLI session expired | `az login --tenant <tenant-id>` |
| `MissingSubscriptionRegistration: Microsoft.App` | Resource provider not registered | `az provider register --namespace Microsoft.App --wait` |
| `MANIFEST_UNKNOWN: manifest tagged by "latest" is not found` | Images not pushed to ACR | Complete Step 5 |
| `alpha numeric characters only are allowed in "name"` | ACR name contains hyphens | ACR name is auto-sanitised — check `terraform output acr_name` |
| RG deletion blocked by nested resources | Non-Terraform resources in the RG | Delete them manually in the Portal first |
| PostgreSQL `zone` conflict | Existing server has a pinned zone | `lifecycle { ignore_changes = [zone] }` is already set |
| nginx 502 proxying to internal Container App | Azure internal FQDN TLS incompatible with nginx upstream SSL | Set `external_enabled = true` on the target app; nginx proxies its public FQDN instead |
