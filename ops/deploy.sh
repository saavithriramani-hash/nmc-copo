#!/usr/bin/env bash
# One command to deploy the system for the first time.
#
#   ops/deploy.sh
#
# Builds the application image, starts the database, application and
# backup containers, and creates the first administrator account. Safe to
# read before running — it does nothing destructive and stops if anything
# is wrong.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Docker is not installed. See docs/OPERATIONS.md." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose ...)." >&2; exit 1; }

if [ ! -f .env ]; then
  echo "No .env file found. Creating one from the template."
  cp .env.example .env
  echo
  echo "  Edit .env and set POSTGRES_PASSWORD to a long random value, then run this again:"
  echo "    nano .env"
  exit 1
fi

# Refuse to deploy with the placeholder password still in place.
if grep -q 'CHANGE_ME_TO_A_LONG_RANDOM_STRING' .env; then
  echo "POSTGRES_PASSWORD is still the placeholder. Edit .env first." >&2
  exit 1
fi

# A one-time token that authorises creating the first administrator.
if ! grep -q '^BOOTSTRAP_TOKEN=' .env; then
  echo "BOOTSTRAP_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)" >> .env
fi
BOOTSTRAP_TOKEN="$(grep '^BOOTSTRAP_TOKEN=' .env | cut -d= -f2-)"

# Build, or pull — whichever this compose file calls for.
#
# docker-compose.yml builds the application from source; the .prod.yml
# variant pulls a published image instead, for a server with too little
# memory to compile it (the build wants about 4 GB). Deciding from the
# RESOLVED configuration rather than a filename means COMPOSE_FILE, an
# override, or a future third variant all work without editing this.
if docker compose config 2>/dev/null | grep -qE '^[[:space:]]+build:'; then
  echo "[deploy] building the application image (this takes a few minutes the first time)..."
  docker compose build
else
  echo "[deploy] pulling the published application image..."
  docker compose pull
fi

echo "[deploy] starting the database..."
docker compose up -d db
echo "[deploy] waiting for the database to be ready..."
until docker compose exec -T db pg_isready -q; do sleep 2; done

echo "[deploy] starting the application and the backup service..."
docker compose up -d app backup

echo "[deploy] waiting for the application to become healthy..."
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:${APP_PORT:-3000}/api/health" >/dev/null 2>&1; then break; fi
  sleep 3
done

echo
echo "[deploy] the application is running at http://localhost:${APP_PORT:-3000}"
echo "[deploy] creating the first administrator account..."
echo
read -r -p "  Administrator email: " ADMIN_EMAIL
read -r -p "  Administrator full name: " ADMIN_NAME

RESPONSE="$(curl -fsS -X POST "http://localhost:${APP_PORT:-3000}/api/bootstrap/admin" \
  -H 'Content-Type: application/json' \
  -H "x-bootstrap-token: ${BOOTSTRAP_TOKEN}" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"fullName\":\"${ADMIN_NAME}\"}")" || {
    echo "Admin creation failed. See docs/OPERATIONS.md > Add an administrator." >&2
    exit 1
  }

# Pull the temporary password out of the JSON response (no jq needed).
TEMP_PW="$(echo "${RESPONSE}" | sed -n 's/.*"temporaryPassword":"\([^"]*\)".*/\1/p')"
echo
echo "  Administrator created: ${ADMIN_EMAIL}"
echo "  Temporary password (shown once): ${TEMP_PW}"
echo "  You must change it at first login."
echo
echo "[deploy] done. Sign in at http://localhost:${APP_PORT:-3000}"
echo "[deploy] check system health at /admin/health once signed in."
