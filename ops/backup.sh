#!/bin/bash
# Takes one PostgreSQL backup: a compressed pg_dump in the custom format
# (the format pg_restore reads), copies it to the second location if one
# is configured, prunes old dumps by the retention policy, and records
# the outcome in backup-status.json for the health page.
#
# Runs inside the `backup` container, which shares Postgres' major version
# so pg_dump always matches the server. Connection comes from the PG*
# environment variables set in docker-compose.yml.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
SECONDARY_DIR="${BACKUP_SECONDARY_DIR:-}"
STATUS_FILE="${BACKUP_DIR}/backup-status.json"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-35}"
KEEP_WEEKLY_DAYS="${KEEP_WEEKLY_DAYS:-400}"
KEEP_MONTHLY_DAYS="${KEEP_MONTHLY_DAYS:-2200}"

mkdir -p "${BACKUP_DIR}"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Merge key/values into the status JSON without needing jq: rewrite the
# file from the fields we track. Reads current values first.
read_status_field() {
  local key="$1"
  [ -f "${STATUS_FILE}" ] || { echo ""; return; }
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\?\([^\",}]*\)\"\?.*/\1/p" "${STATUS_FILE}" | head -n1
}

LAST_SUCCESS="$(read_status_field lastSuccess)"
LAST_SECONDARY="$(read_status_field lastSecondaryCopy)"
LAST_VERIFIED="$(read_status_field lastVerifiedRestore)"

write_status() {
  # Args: lastAttempt lastSuccess lastError sizeBytes durationSeconds secondaryCopy verifiedRestore dumpCount
  local secondary_configured="false"
  [ -n "${SECONDARY_DIR}" ] && secondary_configured="true"
  cat > "${STATUS_FILE}.tmp" <<JSON
{
  "lastAttempt": "$1",
  "lastSuccess": "$2",
  "lastError": $3,
  "lastSizeBytes": $4,
  "lastDurationSeconds": $5,
  "lastSecondaryCopy": "$6",
  "secondaryConfigured": ${secondary_configured},
  "lastVerifiedRestore": "$7",
  "dumpCount": $8
}
JSON
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
}

ATTEMPT="$(now_iso)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUTFILE="${BACKUP_DIR}/copo-${STAMP}.dump"

echo "[backup] starting dump -> ${OUTFILE}"
START_EPOCH="$(date +%s)"

if ! pg_dump --format=custom --compress=9 --file="${OUTFILE}.partial"; then
  echo "[backup] pg_dump FAILED" >&2
  COUNT="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'copo-*.dump' | wc -l | tr -d ' ')"
  write_status "${ATTEMPT}" "${LAST_SUCCESS}" "\"pg_dump failed\"" 0 0 "${LAST_SECONDARY}" "${LAST_VERIFIED}" "${COUNT}"
  exit 1
fi

# Rename only once the dump is complete, so a half-written file with a
# valid name can never exist — a restore always picks a whole dump.
mv "${OUTFILE}.partial" "${OUTFILE}"
SIZE="$(stat -c %s "${OUTFILE}")"
DURATION="$(( $(date +%s) - START_EPOCH ))"
SUCCESS="$(now_iso)"
echo "[backup] dump complete: ${SIZE} bytes in ${DURATION}s"

# ── second copy on campus ──
SECONDARY_STAMP="${LAST_SECONDARY}"
if [ -n "${SECONDARY_DIR}" ]; then
  if mkdir -p "${SECONDARY_DIR}" 2>/dev/null && cp "${OUTFILE}" "${SECONDARY_DIR}/" 2>/dev/null; then
    SECONDARY_STAMP="$(now_iso)"
    echo "[backup] copied to second location ${SECONDARY_DIR}"
    # Prune the second location on the same monthly policy.
    find "${SECONDARY_DIR}" -maxdepth 1 -name 'copo-*.dump' -mtime "+${KEEP_MONTHLY_DAYS}" -delete 2>/dev/null || true
  else
    echo "[backup] WARNING: could not write to second location ${SECONDARY_DIR}" >&2
  fi
fi

# ── retention ──
# Keep every dump for KEEP_DAILY_DAYS. Beyond that keep only Sunday dumps
# for KEEP_WEEKLY_DAYS, and only 1st-of-month dumps for KEEP_MONTHLY_DAYS.
prune() {
  find "${BACKUP_DIR}" -maxdepth 1 -name 'copo-*.dump' -mtime "+${KEEP_DAILY_DAYS}" | while read -r f; do
    local day dom dow
    day="$(basename "$f" | sed -E 's/copo-([0-9]{8})-.*/\1/')"
    dom="${day:6:2}"
    dow="$(date -u -d "${day}" +%u 2>/dev/null || echo 0)" # 7 = Sunday
    if [ "${dom}" = "01" ]; then
      find "$f" -mtime "+${KEEP_MONTHLY_DAYS}" -delete 2>/dev/null || true
    elif [ "${dow}" = "7" ]; then
      find "$f" -mtime "+${KEEP_WEEKLY_DAYS}" -delete 2>/dev/null || true
    else
      rm -f "$f"
    fi
  done
}
prune

COUNT="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'copo-*.dump' | wc -l | tr -d ' ')"
write_status "${ATTEMPT}" "${SUCCESS}" "null" "${SIZE}" "${DURATION}" "${SECONDARY_STAMP}" "${LAST_VERIFIED}" "${COUNT}"
echo "[backup] done; ${COUNT} dumps retained."
