#!/usr/bin/env bash
# One command to upgrade to a new version of the code.
#
#   git pull            # get the new code first
#   ops/upgrade.sh
#
# It takes a fresh backup BEFORE changing anything, rebuilds the image,
# and restarts the application. Database migrations are applied
# automatically when the new application container starts. If the new
# version will not become healthy, it tells you how to roll back.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env file. Run ops/deploy.sh first." >&2; exit 1; }

# The published port comes from .env, which docker compose reads — but
# this shell does not. Without this, ${APP_PORT:-3000} below was the
# SHELL's value, so a deployment published on 3001 was health-checked on
# 3000: a good upgrade reported as a failure, or worse, a different
# application answering on 3000 reported as a good upgrade.
APP_PORT="$(sed -n 's/^APP_PORT=[^0-9]*\([0-9][0-9]*\).*/\1/p' .env | tail -n1)"
APP_PORT="${APP_PORT:-3000}"

# Is the application answering?
#
# The published port first, because that is what people actually use. If
# the host cannot reach it — a port mapping broken by a host restart, say
# — ask inside the container before calling the upgrade failed, so a
# networking fault is reported as one instead of sending the operator to
# roll back code that is running perfectly well.
REACHED=""
app_healthy() {
  if curl -fsS "http://localhost:${APP_PORT}/api/health" >/dev/null 2>&1; then
    REACHED="published port ${APP_PORT}"; return 0
  fi
  if docker compose exec -T app node -e       "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"       >/dev/null 2>&1; then
    REACHED="inside the container ONLY"; return 0
  fi
  return 1
}

echo "[upgrade] taking a safety backup before upgrading..."
docker compose exec -T backup bash /ops/backup.sh \
  || { echo "Safety backup failed — not upgrading. Fix backups first (see /admin/health)." >&2; exit 1; }

echo "[upgrade] recording the current image, so you can roll back..."
PREVIOUS_IMAGE="$(docker compose images app --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -n1 || true)"
echo "${PREVIOUS_IMAGE}" > .last-good-image 2>/dev/null || true

# Build, or pull — see the same decision in deploy.sh. The rollback
# recorded just above works either way: it names the image that was
# running, which is what `docker compose up` would be told to use again.
if docker compose config 2>/dev/null | grep -qE '^[[:space:]]+build:'; then
  echo "[upgrade] building the new image..."
  docker compose build app
else
  echo "[upgrade] pulling the new published image..."
  docker compose pull app
fi

echo "[upgrade] restarting the application (migrations apply on start)..."
docker compose up -d app

echo "[upgrade] waiting for the new version to become healthy..."
HEALTHY=0
for _ in $(seq 1 40); do
  if app_healthy; then HEALTHY=1; break; fi
  sleep 3
done

if [ "${HEALTHY}" -eq 1 ]; then
  echo "[upgrade] done — the new version is running and healthy (reached via ${REACHED})."
  if [ "${REACHED}" = "inside the container ONLY" ]; then
    echo
    echo "  !!  The application is healthy but NOBODY OUTSIDE THE SERVER CAN REACH IT." >&2
    echo "  !!  The published port ${APP_PORT} is not answering. The upgrade itself is fine;" >&2
    echo "  !!  the port mapping is not. Try:  docker compose up -d --force-recreate app" >&2
  fi
else
  echo
  echo "  !!  The new version did not become healthy." >&2
  echo "  !!  Check the logs:   docker compose logs --tail=50 app" >&2
  echo "  !!  To roll back:      git checkout <previous-commit> && ops/upgrade.sh" >&2
  echo "  !!  Your data is safe: a backup was taken before this upgrade began." >&2
  exit 1
fi
