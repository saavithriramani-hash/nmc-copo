#!/usr/bin/env bash
# Full institutional data export from the command line, as an alternative
# to the button in the application (NFR-12). Writes every table as CSV,
# using the database's own COPY — so it works even if the application is
# down. Open formats; the college is never locked in.
#
#   ops/export-institution.sh [output-directory]
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-./institutional-export-$(date -u +%Y%m%d)}"
mkdir -p "${OUT}"
echo "[export] writing CSVs to ${OUT}"

# Tables to export, in dependency order. Passwords are excluded.
TABLES=(
  Institution Department Programme ProgrammeOutcome Batch Student BatchRoster
  Course CourseInstructor CourseOutcome ArticulationMatrix Enrolment
  Assessment AssessmentCoTag Section Item MarkValue IndirectFeedback
  AssessmentTemplate AttainmentSnapshot Role AuditLog
)

for t in "${TABLES[@]}"; do
  echo "[export]   ${t}"
  docker compose exec -T db psql -U "${POSTGRES_USER:-copo}" -d "${POSTGRES_DB:-copo}" \
    -c "\\copy (SELECT * FROM \"${t}\") TO STDOUT WITH CSV HEADER" > "${OUT}/${t}.csv"
done

# Users without password hashes.
docker compose exec -T db psql -U "${POSTGRES_USER:-copo}" -d "${POSTGRES_DB:-copo}" \
  -c "\\copy (SELECT id,email,\"fullName\",\"identityProvider\",\"isActive\",\"createdAt\",\"updatedAt\" FROM \"User\") TO STDOUT WITH CSV HEADER" \
  > "${OUT}/User.csv"

cat > "${OUT}/README.txt" <<'EOF'
Full institutional data export — CO–PO attainment system.
Every file is a CSV: UTF-8, comma-separated, first row is the header.

BLANK IS NOT ZERO. An empty field means "no value". In MarkValue.csv an
empty "value" means the student did not attempt that item (excluded from
attainment); a 0 means they attempted and scored nothing (included).

Passwords are deliberately not exported. AttainmentSnapshot.csv holds the
immutable record of every locked course. These are open formats and need
none of the original software to read.
EOF

echo "[export] done. ${OUT} contains one CSV per table plus README.txt."
