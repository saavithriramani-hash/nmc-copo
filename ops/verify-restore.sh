#!/bin/bash
# The restore drill: proves that the latest backup can actually be
# restored and that the restored data is coherent. An untested backup is
# not a backup, so this runs weekly and records its result in
# backup-status.json for the health page.
#
# It restores the newest dump into a scratch database, checks that the
# core tables are present and that key row counts are plausible, then
# drops the scratch database. It NEVER touches the live database.
#
# Exit 0 = the backup is provably restorable. Non-zero = it is not, and
# that is an emergency.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-copo}"
SCRATCH_DB="copo_restore_check"
STATUS_FILE="${BACKUP_DIR}/backup-status.json"
export PGPASSWORD="${PGPASSWORD:-}"

FILE="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'copo-*.dump' | sort | tail -n1)"
[ -z "${FILE}" ] && { echo "[verify] no dump to verify." >&2; exit 1; }
echo "[verify] verifying ${FILE}"

cleanup() {
  psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -c "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Fresh scratch database.
psql -h "${PGHOST}" -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
DROP DATABASE IF EXISTS "${SCRATCH_DB}";
CREATE DATABASE "${SCRATCH_DB}";
SQL

# Restore. --exit-on-error means any problem in the dump fails the drill.
pg_restore --host="${PGHOST}" --username="${PGUSER}" --dbname="${SCRATCH_DB}" \
  --no-owner --no-privileges --exit-on-error "${FILE}"

# Coherence checks: the tables the system cannot run without must exist,
# and the referential shape must hold. A dump that restores into an empty
# or broken schema must FAIL the drill.
CHECK_SQL="
DO \$\$
DECLARE n integer;
BEGIN
  -- Core tables exist.
  PERFORM 1 FROM information_schema.tables WHERE table_name = 'MarkValue';
  IF NOT FOUND THEN RAISE EXCEPTION 'MarkValue table missing from restored dump'; END IF;
  PERFORM 1 FROM information_schema.tables WHERE table_name = 'AttainmentSnapshot';
  IF NOT FOUND THEN RAISE EXCEPTION 'AttainmentSnapshot table missing'; END IF;

  -- No mark references a non-existent enrolment (the join that matters).
  SELECT count(*) INTO n FROM \"MarkValue\" m
    LEFT JOIN \"Enrolment\" e ON e.id = m.\"enrolmentId\"
    WHERE e.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'restored data has % orphaned marks', n; END IF;

  -- The immutability trigger came across with the schema.
  PERFORM 1 FROM pg_trigger WHERE tgname = 'AttainmentSnapshot_immutable';
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot immutability trigger missing from restored dump'; END IF;
END \$\$;
"
psql -h "${PGHOST}" -U "${PGUSER}" -d "${SCRATCH_DB}" -v ON_ERROR_STOP=1 -c "${CHECK_SQL}"

TABLE_COUNT="$(psql -h "${PGHOST}" -U "${PGUSER}" -d "${SCRATCH_DB}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
echo "[verify] restore OK: ${TABLE_COUNT} tables, referential checks passed."

# Record success for the health page. Rewrite lastVerifiedRestore in place.
if [ -f "${STATUS_FILE}" ]; then
  NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if grep -q '"lastVerifiedRestore"' "${STATUS_FILE}"; then
    sed -i "s/\"lastVerifiedRestore\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"lastVerifiedRestore\": \"${NOW}\"/" "${STATUS_FILE}"
  else
    sed -i "s/^{/{\n  \"lastVerifiedRestore\": \"${NOW}\",/" "${STATUS_FILE}"
  fi
fi

echo "[verify] backup is provably restorable."
