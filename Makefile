# Applysy dev shortcuts. See README "One-line dev environment" for details.
.PHONY: dev dev-admin dev-obs dev-all help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## Full app stack with hot reload (postgres + cv-api + llm-service + ui-angular + chat-ui)
	bash scripts/dev.sh

dev-admin: ## dev + admin-db + admin-api + admin-ui
	bash scripts/dev.sh --with-admin

dev-obs: ## dev + Langfuse LLM tracing
	bash scripts/dev.sh --with-obs

dev-all: ## dev + admin stack + Langfuse tracing
	bash scripts/dev.sh --with-admin --with-obs
