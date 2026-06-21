# Applysy dev shortcuts. See README "One-line dev environment" for details.
.PHONY: dev dev-admin dev-obs dev-all migrate migration help

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

migrate: ## Apply EF Core migrations to the local cv-api database
	dotnet run --project apps/cv-api -- migrate

migration: ## Create a new EF Core migration (usage: make migration NAME=AddFoo)
	@test -n "$(NAME)" || { echo "Usage: make migration NAME=<MigrationName>"; exit 1; }
	dotnet ef migrations add $(NAME) --project apps/cv-api
