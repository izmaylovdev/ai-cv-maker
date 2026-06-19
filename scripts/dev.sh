#!/usr/bin/env bash
#
# One-line local dev environment.
#
#   npm run dev                    # postgres + cv-api + llm-service + ui-angular + chat-ui
#   npm run dev -- --with-admin    # also start admin-db + admin-api + admin-ui
#   npm run dev -- --with-obs      # also start the Langfuse LLM-tracing stack and
#                                  #   point the host llm-service at it
#
# Starts the Docker dependencies, then runs every app's hot-reload dev server
# concurrently with prefixed logs. Ctrl-C tears the whole thing down.
#
# Note: --with-obs covers LLM tracing (Langfuse), the only observability that
# works against host dev servers. Prometheus/Grafana scrape the *containerized*
# cv-api/llm-service by their compose DNS names, so use the full
# `docker compose up` stack for metrics, not this host-reload workflow.
set -euo pipefail

cd "$(dirname "$0")/.."

# Local Langfuse keys — must match docker-compose.langfuse.yml and the
# llm-service:evals target (apps/llm-service/project.json).
LANGFUSE_PUBLIC_KEY_LOCAL=pk-lf-local-dev
LANGFUSE_SECRET_KEY_LOCAL=sk-lf-local-dev
LANGFUSE_HOST_LOCAL=http://localhost:3030

WITH_ADMIN=0
WITH_OBS=0
for arg in "$@"; do
  case "$arg" in
    --with-admin) WITH_ADMIN=1 ;;
    --with-obs)   WITH_OBS=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# App dev servers as "label=nx-target" pairs.
servers=(
  "cv-api=cv-api:serve"
  "llm=llm-service:serve"
  "app=ui-angular:serve"
  "chat=chat-ui:dev"
)
# Compose files and Docker dependencies the dev servers need.
compose_files=(-f docker-compose.yml)
deps=(postgres)

if [[ "$WITH_ADMIN" == "1" ]]; then
  deps+=(admin-db)
  servers+=(
    "admin-api=admin-api:serve"
    "admin-ui=admin-ui:dev"
  )
fi

if [[ "$WITH_OBS" == "1" ]]; then
  compose_files+=(-f docker-compose.langfuse.yml)
  # depends_on pulls in clickhouse, redis, minio (and the langfuse postgres DB).
  deps+=(langfuse-web langfuse-worker)
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "[dev] shutting down..."
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  pkill -9 -f 'nx run' 2>/dev/null || true
  npx nx daemon --stop >/dev/null 2>&1 || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Launch one dev server in the background with prefixed logs. A non-empty third
# arg enables Langfuse tracing for that server (host llm-service only).
launch() {
  local label=$1 target=$2 trace=${3:-0}
  echo "[dev] launching ${label} (nx run ${target})"
  if [[ "$trace" == "1" ]]; then
    (export LANGFUSE_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY_LOCAL" \
            LANGFUSE_SECRET_KEY="$LANGFUSE_SECRET_KEY_LOCAL" \
            LANGFUSE_HOST="$LANGFUSE_HOST_LOCAL"
     npx nx run "$target" 2>&1 | sed "s/^/[${label}] /") &
  else
    (npx nx run "$target" 2>&1 | sed "s/^/[${label}] /") &
  fi
  pids+=($!)
}

# Clear any stale nx state so the serves start clean (mirrors serve:* scripts).
pkill -9 -f 'nx run' 2>/dev/null || true
npx nx daemon --stop >/dev/null 2>&1 || true

echo "[dev] starting docker dependencies: ${deps[*]}"
docker compose "${compose_files[@]}" up -d "${deps[@]}"

if [[ "$WITH_OBS" == "1" ]]; then
  echo "[dev] Langfuse UI: ${LANGFUSE_HOST_LOCAL} (login: admin@example.com / changeme-langfuse)"
fi

for entry in "${servers[@]}"; do
  label="${entry%%=*}"
  target="${entry#*=}"
  if [[ "$WITH_OBS" == "1" && "$label" == "llm" ]]; then
    launch "$label" "$target" 1
  else
    launch "$label" "$target"
  fi
done

echo "[dev] all servers launched — press Ctrl-C to stop"
wait
