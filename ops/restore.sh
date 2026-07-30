#!/bin/bash
# Restores a backup into a database.
#
#   ops/restore.sh                     restore the newest dump into a
#                                      throwaway "copo_restore_check" DB
#   ops/restore.sh <file>              restore a specific dump file
#   ops/restore.sh <file> --into-prod  restore OVER the live database
#                                      (asks for confirmation first)
#
# The default is deliberately SAFE: it restores into a scratch database so
# you can rehearse a restore without touching live data. Restoring over
# production requires the explicit --into-prod flag AND typing the word
# RESTORE, because it replaces everything.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-copo}"
PROD_DB="${PGDATABASE:-copo}"
SCRATCH_DB="copo_restore_check"

FILE="${1:-}"
MODE="${2:-}"

if [ -z "${FILE}" ] || [ "${FILE}" = "--latest" ]; then
  FILE="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'copo-*.dump' | sort | tail -n1)"
  [ -z "${FILE}" ] && { echo "No dump files found in ${BACKUP_DIR}." >&2; exit 1; }
fi
[ -f "${FILE}" ] || { echo "Backup file not found: ${FILE}" >&2; exit 1; }

echo "Restoring from: ${FILE}"

if [ "${MODE}" = "--into-prod" ]; then
  echo
  echo "  !!  This will REPLACE the live database '${PROD_DB}' with the backup."
  echo "  !!  Everything entered since that backup will be lost."
  echo
  read -r -p "  Type RESTORE to proceed: " CONFIRM
  [ "${CONFIRM}" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
  TARGET="${PROD_DB}"
  echo "Stop the application first so nothing writes during the restore:"
  echo "  docker compose stop app"
else
  TARGET="${SCRATCH_DB}"
  echo "Safe mode: restoring into scratch database '${TARGET}' (live data untouched)."
fi

export PGPASSWORD="${PGPASSWORD:-}"

# Recreate the target database from scratch, then restore into it. Using
# --create would embed the source name; instead we manage the target DB
# ourselves so the same dump can go into prod or scratch.
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${TARGET}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${TARGET}";
CREATE DATABASE "${TARGET}";
SQL

pg_restore --host="${PGHOST}" --username="${PGUSER}" --dbname="${TARGET}" \
  --no-owner --no-privileges --exit-on-error "${FILE}"

echo
echo "Restore complete into '${TARGET}'."
if [ "${MODE}" = "--into-prod" ]; then
  echo "Start the application again: docker compose start app"
else
  echo "Inspect it with:  psql -h ${PGHOST} -U ${PGUSER} -d ${TARGET}"
  echo "Drop it when done: psql -h ${PGHOST} -U ${PGUSER} -d postgres -c 'DROP DATABASE ${TARGET}'"
fi
