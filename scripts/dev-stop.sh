#!/usr/bin/env bash
#
# Kill any host dev servers left running in the background.
#
#   make dev-stop   (or: bash scripts/dev-stop.sh)
#
# `make dev*` launches every app's hot-reload server as a background process.
# Ctrl-C normally tears them down (see cleanup() in scripts/dev.sh), but if a
# terminal was closed, a process crashed, or a server was started standalone
# (npm run serve:*), orphans can keep squatting on the dev ports. This kills
# them all. It does NOT touch the Docker dependencies — stop those with
# `docker compose down` if you want the containers gone too.
#
# Note on the Firestore emulator (ADR-0021): it holds the database in memory and
# dumps it to the firestore_data volume when it receives SIGTERM. `docker compose
# stop` and `docker compose down` both send that signal, so local data survives.
# `docker compose kill`, `docker rm -f` and `docker compose down -v` do not —
# use those only when you actually want to start from an empty database.
set -uo pipefail

cd "$(dirname "$0")/.."

echo "[dev-stop] killing host dev servers..."

# nx-driven serves (cv-api, llm, ui-angular, chat, builder, admin-api/ui). This
# also cascades to the vite dev servers they run in-process. Nx runs continuous
# executors (e.g. ui-angular:serve holding 4200) as detached run-executor.js
# forks whose command line is NOT 'nx run', so match that separately too.
pkill -9 -f 'nx run' 2>/dev/null || true
pkill -9 -f 'nx/bin/run-executor' 2>/dev/null || true

# dotnet watch detaches the compiled cv-api host; Next.js detaches next-server;
# the llm-service runs a detached python process — none match 'nx run', so kill
# them explicitly to free 5050 (cv-api), 3002 (admin-ui) and 8080/9090 (llm).
pkill -9 -f 'dotnet watch' 2>/dev/null || true
pkill -9 -f 'bin/Debug/.*/cv-api' 2>/dev/null || true
pkill -9 -f 'next-server' 2>/dev/null || true
pkill -9 -f '\.venv/bin/python -m app\.main' 2>/dev/null || true

# Stray vite workers occasionally outlive their nx parent.
pkill -9 -f 'vite' 2>/dev/null || true

# Stop the nx daemon so the next serve starts from clean state.
npx nx daemon --stop >/dev/null 2>&1 || true

echo "[dev-stop] done. (Docker deps left running — 'docker compose down' to stop those.)"
