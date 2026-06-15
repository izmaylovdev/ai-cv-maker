#!/usr/bin/env bash
#
# Load cv-api secrets from the root .env into .NET User Secrets.
#
# User Secrets live outside the repo (~/.microsoft/usersecrets/<id>/), so they
# replace the old git-ignored appsettings.Local.json with no risk of being
# committed or shipped in the Docker image. The config system layers them
# after appsettings.Development.json in the Development environment.
#
# Usage:
#   ./scripts/load-cv-api-secrets.sh [path-to-.env]
#
# Defaults to the repo-root .env. Re-running is safe — it overwrites.
#
# Env overrides for the local DB endpoint (host-side, outside docker):
#   DB_HOST (default localhost)   DB_PORT (default 5433, the compose mapping)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$REPO_ROOT/.env}"
PROJECT="$REPO_ROOT/apps/cv-api"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"

# Direct ".env key -> .NET config key" pairs (cv-api secrets only).
# Kept as a plain list so the stock macOS bash 3.2 works (no assoc arrays).
DIRECT_MAP="
GOOGLE_CLIENT_SECRET=Google:ClientSecret
JWT_SECRET=JwtSettings:Secret
"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: .env not found at $ENV_FILE" >&2
  exit 1
fi

# Read one key's value from .env without sourcing it (never executes the file).
read_env() {
  local key="$1" line val
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n1 || true)"
  [[ -z "$line" ]] && return 1
  val="${line#*=}"
  if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
    val="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$val"
}

set_secret() { # key value
  dotnet user-secrets set "$1" "$2" --project "$PROJECT" >/dev/null
  echo "  set $1"
}

echo "Loading cv-api secrets from $ENV_FILE -> User Secrets ($PROJECT)"
dotnet user-secrets init --project "$PROJECT" >/dev/null 2>&1 || true

loaded=0; missing=0
while IFS='=' read -r env_key secret_key; do
  [[ -z "$env_key" ]] && continue
  if value="$(read_env "$env_key")"; then
    set_secret "$secret_key" "$value"; loaded=$((loaded+1))
  else
    echo "  skip $secret_key ($env_key not in .env)" >&2; missing=$((missing+1))
  fi
done <<< "$DIRECT_MAP"

# Compose the local DefaultConnection from the POSTGRES_* parts. The docker
# postgres is published on $DB_HOST:$DB_PORT, so a host-side `dotnet run`
# connects there (compose injects its own connection string in-container).
if db="$(read_env POSTGRES_DB)" && user="$(read_env POSTGRES_USER)" && pass="$(read_env POSTGRES_PASSWORD)"; then
  conn="Host=${DB_HOST};Port=${DB_PORT};Database=${db};Username=${user};Password=${pass}"
  set_secret "ConnectionStrings:DefaultConnection" "$conn"; loaded=$((loaded+1))
else
  echo "  skip ConnectionStrings:DefaultConnection (POSTGRES_* incomplete in .env)" >&2; missing=$((missing+1))
fi

echo "Done: $loaded set, $missing missing."
echo "Verify with: dotnet user-secrets list --project apps/cv-api"
exit 0
