#!/bin/bash
# Nightly housekeeping: removes the working files and bookkeeping rows
# that would otherwise grow without limit. Runs from backup-loop.sh after
# each backup, so there is no second timer for anyone to maintain.
#
# WHAT THIS NEVER TOUCHES
#
#   AuditLog        who changed what, and the prior value (FR-17/NFR-9).
#                   It is the record an accreditation auditor may ask to
#                   see, it costs about 500 bytes an entry — a few hundred
#                   MB over a five-year cycle — and pruning it would save
#                   nothing worth having. There is deliberately no
#                   retention setting for it.
#   MarkValue       the marks themselves, and the largest thing on disk.
#   AttainmentSnapshot  the immutable record of what was approved.
#   Anything under /backups   backup.sh owns that retention.
#
# Everything below is derived, reproducible, or expired.
set -uo pipefail

: "${PGHOST:?PGHOST must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"

# Retention windows, overridable in .env alongside the KEEP_*_DAYS above.
KEEP_BUNDLE_WORKDIR_DAYS="${KEEP_BUNDLE_WORKDIR_DAYS:-30}"
KEEP_JOB_DAYS="${KEEP_JOB_DAYS:-180}"
KEEP_EXPIRED_SESSION_DAYS="${KEEP_EXPIRED_SESSION_DAYS:-90}"
STORAGE_DIR="${COPO_STORAGE_DIR:-/app/storage}"

echo "[cleanup] starting $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 1. Bundle working directories ────────────────────────────────────────
# Each accreditation bundle is assembled in storage/bundles/<jobId>/ and
# then zipped. The directory is KEPT on purpose so a bundle that died
# half-way can be resumed — but once the .zip exists it is dead weight,
# and it roughly doubles what every bundle costs.
#
# Only directories are removed, and only ones older than the window. The
# .zip files are the deliverable and are never touched here; an operator
# deletes those by hand once they have been downloaded (OPERATIONS §9.4).
if [ -d "${STORAGE_DIR}/bundles" ]; then
  FREED_BEFORE="$(du -sk "${STORAGE_DIR}/bundles" 2>/dev/null | cut -f1 || echo 0)"
  find "${STORAGE_DIR}/bundles" -mindepth 1 -maxdepth 1 -type d \
    -mtime "+${KEEP_BUNDLE_WORKDIR_DAYS}" -exec rm -rf {} + 2>/dev/null || true
  FREED_AFTER="$(du -sk "${STORAGE_DIR}/bundles" 2>/dev/null | cut -f1 || echo 0)"
  echo "[cleanup] bundle working dirs older than ${KEEP_BUNDLE_WORKDIR_DAYS}d: freed $(( (FREED_BEFORE - FREED_AFTER) / 1024 )) MB"
else
  echo "[cleanup] no bundle storage mounted at ${STORAGE_DIR}/bundles — skipping file cleanup"
fi

# ── 2. Finished job rows ─────────────────────────────────────────────────
# A consolidation's result holds a row per course and is kept so the page
# can be reopened. After KEEP_JOB_DAYS nobody is reopening it, and the run
# can simply be repeated — every figure is recomputed from the marks.
#
# Only FINISHED jobs go: a PENDING or RUNNING row may be a live job, and
# a restartable one is resumed from its row (NFR-4).
psql -v ON_ERROR_STOP=1 -q <<SQL
DELETE FROM "Job"
 WHERE status IN ('COMPLETED', 'FAILED')
   AND "finishedAt" IS NOT NULL
   AND "finishedAt" < now() - interval '${KEEP_JOB_DAYS} days';
SQL
echo "[cleanup] finished jobs older than ${KEEP_JOB_DAYS}d removed"

# ── 3. Dead sessions ─────────────────────────────────────────────────────
# Session rows are revoked by timestamp rather than deleted, so that a
# sign-out is a fact rather than an absence. That is right for the recent
# past and pointless for the distant past: the login history an auditor
# reads lives in AuditLog (LOGIN_SUCCESS / LOGOUT), which is untouched.
#
# Only rows that can no longer authenticate anyone are removed — already
# revoked, or past their absolute expiry.
psql -v ON_ERROR_STOP=1 -q <<SQL
DELETE FROM "Session"
 WHERE ("revokedAt" IS NOT NULL AND "revokedAt" < now() - interval '${KEEP_EXPIRED_SESSION_DAYS} days')
    OR ("expiresAt" < now() - interval '${KEEP_EXPIRED_SESSION_DAYS} days');
SQL
echo "[cleanup] sessions dead for more than ${KEEP_EXPIRED_SESSION_DAYS}d removed"

# ── report ───────────────────────────────────────────────────────────────
psql -q -t <<'SQL'
SELECT '[cleanup] remaining: '
    || (SELECT count(*) FROM "Job")     || ' jobs, '
    || (SELECT count(*) FROM "Session") || ' sessions, '
    || (SELECT count(*) FROM "AuditLog")|| ' audit entries (never pruned)';
SQL

echo "[cleanup] done"
