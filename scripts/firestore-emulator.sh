#!/usr/bin/env bash
#
# Container entrypoint for the local Firestore emulator (ADR-0021 decision #8).
# Runs inside gcr.io/google.com/cloudsdktool/google-cloud-cli:*-emulators; it is
# bind-mounted by the `firestore` service in docker-compose.yml.
#
# WHY A WRAPPER AND NOT A PLAIN `command:`
#
# The emulator is in-memory. Without an explicit export/import the whole database
# is lost on every `docker compose down`, which would be a real regression on the
# postgres_data / admin_db_data volumes it replaces. Two things make that awkward:
#
#  1. `--import-data` wants the *.overall_export_metadata file, which only exists
#     after a successful export. Passing a missing path makes the emulator refuse
#     to start, so the flag has to be added conditionally — i.e. in a script.
#  2. `--export-on-exit` is unreliable here: `gcloud emulators firestore start`
#     is a Python wrapper that spawns a bash script that spawns the Java emulator.
#     PID 1 is the Python wrapper, and it does not forward compose's SIGTERM down
#     to Java, so the shutdown hook that writes the export never runs. Verified:
#     the export directory stays empty after `docker stop`.
#
# So the wrapper traps SIGTERM/SIGINT itself and calls the emulator's own export
# endpoint (POST /emulator/v1/projects/{p}:export — the same one the Firebase CLI
# uses) before shutting the emulator down. --export-on-exit is still passed as a
# belt-and-braces fallback.
set -euo pipefail

BIND="${FIRESTORE_EMULATOR_BIND:-0.0.0.0:8085}"
PORT="${BIND##*:}"
DATA_DIR="${FIRESTORE_EMULATOR_DATA_DIR:-/data/firestore-export}"
PROJECT="${GOOGLE_CLOUD_PROJECT:-applysy-local}"

mkdir -p "$DATA_DIR"

# gcloud insists on *a* configured project. The emulator only uses it to namespace
# its in-memory database, so this never touches a real GCP project.
gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1 || true

import_args=()
metadata="$(find "$DATA_DIR" -maxdepth 2 -name '*.overall_export_metadata' -print -quit 2>/dev/null || true)"
if [[ -n "$metadata" ]]; then
  echo "[firestore] importing previous data from ${metadata}"
  import_args+=("--import-data=${metadata}")
else
  echo "[firestore] no previous export under ${DATA_DIR} — starting with an empty database"
fi

emulator_pid=""

export_data() {
  echo "[firestore] exporting database to ${DATA_DIR} ..."
  # The emulator refuses to export into a directory that already holds an export
  # under the same name, so clear the previous one first. It has already been
  # imported into memory at this point, so nothing is lost.
  rm -rf "${DATA_DIR:?}/${PROJECT}"
  if curl -sf -m 120 -X POST \
      "http://localhost:${PORT}/emulator/v1/projects/${PROJECT}:export" \
      -H 'Content-Type: application/json' \
      -d "{\"database\":\"projects/${PROJECT}/databases/(default)\",\"export_directory\":\"${DATA_DIR}\",\"export_name\":\"${PROJECT}\"}" \
      >/dev/null; then
    echo "[firestore] export complete — data will be reloaded on next start"
  else
    echo "[firestore] WARNING: export failed; this run's data will NOT persist" >&2
  fi
}

shutdown() {
  trap - TERM INT
  export_data
  [[ -n "$emulator_pid" ]] && kill -TERM "$emulator_pid" 2>/dev/null || true
  wait "$emulator_pid" 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

echo "[firestore] project=${PROJECT} listening on ${BIND}; data persists to ${DATA_DIR}"

gcloud beta emulators firestore start \
  --host-port="$BIND" \
  --database-mode=firestore-native \
  --export-on-exit="$DATA_DIR" \
  "${import_args[@]}" &
emulator_pid=$!

# First `wait` is interrupted by the trap; the handler exits, so the loop below
# only matters when the emulator dies on its own.
wait "$emulator_pid"
