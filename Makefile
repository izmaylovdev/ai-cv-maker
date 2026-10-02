# Applysy dev shortcuts. See README "One-line dev environment" for details.
.PHONY: dev dev-admin dev-obs dev-all dev-stop help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## Full app stack with hot reload (firestore emulator + cv-api + llm-service + ui-angular + chat-ui + profile-builder-ui)
	bash scripts/dev.sh

dev-admin: ## dev + admin-api + admin-ui (same Firestore emulator)
	bash scripts/dev.sh --with-admin

dev-obs: ## dev + Langfuse LLM tracing
	bash scripts/dev.sh --with-obs

dev-all: ## dev + admin stack + Langfuse tracing
	bash scripts/dev.sh --with-admin --with-obs

dev-stop: ## Kill any host dev servers left running in the background
	bash scripts/dev-stop.sh

# No migrate/migration targets: cv-api persists to Firestore, which is
# schemaless (ADR-0021).
