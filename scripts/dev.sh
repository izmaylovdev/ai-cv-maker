#!/usr/bin/env bash
#
# One-line local dev environment.
#
#   npm run dev                    # postgres + cv-api + llm-service + ui-angular + chat-ui + profile-builder-ui
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

# Tempo OTLP endpoint for distributed tracing (ADR-0016). The Tempo container
# publishes 4317, so host-run cv-api/llm-service export to localhost.
OTEL_ENDPOINT_LOCAL=http://localhost:4317

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
  "builder=profile-builder-ui:dev"
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
  compose_files+=(-f docker-compose.langfuse.yml -f docker-compose.obs-dev.yml)
  # langfuse depends_on pulls in clickhouse, redis, minio (and the langfuse
  # postgres DB). prometheus + grafana come from the obs-dev overlay, scraping
  # the host-run cv-api/llm-service (their depends_on is cleared there). tempo
  # receives OTLP traces (ADR-0016) from the same host servers on localhost:4317.
  deps+=(langfuse-web langfuse-worker prometheus grafana tempo)
  # Enable OpenTelemetry export for the host-run cv-api/llm-service. Gated on
  # this endpoint, so it's a no-op without --with-obs.
  export OTEL_EXPORTER_OTLP_ENDPOINT="$OTEL_ENDPOINT_LOCAL"
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "[dev] shutting down..."
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  pkill -9 -f 'nx run' 2>/dev/null || true
  # dotnet watch detaches the compiled cv-api host process, and Next.js detaches
  # its next-server child; neither matches 'nx run', so kill them explicitly to
  # avoid orphans squatting on 5050 (cv-api) / 3002 (admin-ui) after Ctrl-C.
  pkill -9 -f 'dotnet watch' 2>/dev/null || true
  pkill -9 -f 'bin/Debug/.*/cv-api' 2>/dev/null || true
  pkill -9 -f 'next-server' 2>/dev/null || true
  npx nx daemon --stop >/dev/null 2>&1 || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Per-label host port for dev servers that would otherwise collide. admin-api
# (Nest) and admin-ui (Next) both default to 3000; pin them to the ports their
# containers publish (admin-api 3001, admin-ui 3002). Both honour $PORT.
# Plain case (not an associative array) for bash 3.2 (macOS) compatibility.
port_for() {
  case "$1" in
    admin-api) echo 3001 ;;
    admin-ui)  echo 3002 ;;
    *)         echo "" ;;
  esac
}

# Extra env per label. admin-ui's server routes proxy to admin-api via
# $ADMIN_API_URL (defaulting to :3000); point it at admin-api's local port.
extra_env_for() {
  case "$1" in
    admin-ui) echo "ADMIN_API_URL=http://localhost:3001" ;;
    # OTEL_SERVICE_NAME labels the service in Tempo; harmless without an
    # OTLP endpoint set (tracing stays off — see --with-obs).
    cv-api)   echo "OTEL_SERVICE_NAME=cv-api" ;;
    llm)      echo "OTEL_SERVICE_NAME=llm-service" ;;
    *)        echo "" ;;
  esac
}

# Launch one dev server in the background with prefixed logs. A non-empty third
# arg enables Langfuse tracing for that server (host llm-service only).
launch() {
  local label=$1 target=$2 trace=${3:-0}
  local port extra
  port="$(port_for "$label")"
  extra="$(extra_env_for "$label")"
  echo "[dev] launching ${label} (nx run ${target})${port:+ on port ${port}}"
  if [[ "$trace" == "1" ]]; then
    (export LANGFUSE_PUBLIC_KEY="$LANGFUSE_PUBLIC_KEY_LOCAL" \
            LANGFUSE_SECRET_KEY="$LANGFUSE_SECRET_KEY_LOCAL" \
            LANGFUSE_HOST="$LANGFUSE_HOST_LOCAL"
     [[ -n "$port" ]] && export PORT="$port"
     [[ -n "$extra" ]] && export $extra
     npx nx run "$target" 2>&1 | sed "s/^/[${label}] /") &
  else
    ([[ -n "$port" ]] && export PORT="$port"
     [[ -n "$extra" ]] && export $extra
     npx nx run "$target" 2>&1 | sed "s/^/[${label}] /") &
  fi
  pids+=($!)
}

# Clear any stale nx state so the serves start clean (mirrors serve:* scripts).
pkill -9 -f 'nx run' 2>/dev/null || true
npx nx daemon --stop >/dev/null 2>&1 || true

echo "[dev] starting docker dependencies: ${deps[*]}"
docker compose "${compose_files[@]}" up -d "${deps[@]}"

for entry in "${servers[@]}"; do
  label="${entry%%=*}"
  target="${entry#*=}"
  if [[ "$WITH_OBS" == "1" && "$label" == "llm" ]]; then
    launch "$label" "$target" 1
  else
    launch "$label" "$target"
  fi
done

echo ""
echo "[dev] ┌─ Service links ─────────────────────────────────────────"
echo "[dev] │ ui-angular (main SPA)   http://localhost:4200"
echo "[dev] │ chat-ui widget          http://localhost:4202"
echo "[dev] │ profile-builder widget  http://localhost:4203"
echo "[dev] │ cv-api (REST)           http://localhost:5050"
echo "[dev] │ llm-service             gRPC localhost:8080 · metrics http://localhost:9090/metrics"
if [[ "$WITH_ADMIN" == "1" ]]; then
  echo "[dev] │ admin-ui                http://localhost:3002"
  echo "[dev] │ admin-api (REST)        http://localhost:3001/api"
fi
if [[ "$WITH_OBS" == "1" ]]; then
  echo "[dev] │ Langfuse UI             ${LANGFUSE_HOST_LOCAL} (admin@example.com / changeme-langfuse)"
  echo "[dev] │ Grafana                 http://localhost:3003 (admin / admin)"
  echo "[dev] │ Prometheus              http://localhost:9091"
  echo "[dev] │ Tempo (traces)          via Grafana Explore → Tempo datasource"
fi
echo "[dev] └─────────────────────────────────────────────────────────"
echo ""
echo "[dev] all servers launched — press Ctrl-C to stop"
wait
