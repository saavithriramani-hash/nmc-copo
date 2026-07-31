#!/bin/bash
# The backup container's main process. Sleeps until BACKUP_AT each night,
# runs one backup, and once a week proves that the latest backup can
# actually be restored (an untested backup is not a backup). Runs forever;
# restart policy `unless-stopped` keeps it alive across reboots.
set -uo pipefail

BACKUP_AT="${BACKUP_AT:-02:00}"
VERIFY_EVERY_DAYS="${VERIFY_EVERY_DAYS:-7}"

echo "[backup-loop] nightly backup scheduled for ${BACKUP_AT}; restore drill every ${VERIFY_EVERY_DAYS} days."

seconds_until() {
  local target="$1" now target_epoch
  now="$(date +%s)"
  target_epoch="$(date -d "today ${target}" +%s 2>/dev/null || echo 0)"
  if [ "${target_epoch}" -le "${now}" ]; then
    target_epoch="$(date -d "tomorrow ${target}" +%s)"
  fi
  echo "$(( target_epoch - now ))"
}

# On first start, if there has never been a backup, take one immediately
# so the system is protected from minute one rather than from 2am.
if [ ! -f "${BACKUP_DIR:-/backups}/backup-status.json" ]; then
  echo "[backup-loop] no backup yet — taking one now."
  bash /ops/backup.sh || echo "[backup-loop] initial backup failed; will retry tonight." >&2
fi

while true; do
  WAIT="$(seconds_until "${BACKUP_AT}")"
  echo "[backup-loop] sleeping ${WAIT}s until ${BACKUP_AT}."
  sleep "${WAIT}"

  bash /ops/backup.sh || echo "[backup-loop] backup failed; see above." >&2

  # Housekeeping runs AFTER the backup, never before: if cleanup ever
  # removed something it should not have, the dump taken minutes earlier
  # still has it. A cleanup failure is never allowed to stop the loop —
  # backups matter more than disk tidiness.
  bash /ops/cleanup.sh || echo "[backup-loop] cleanup failed; disk may grow. See above." >&2

  # Weekly restore drill: only when the last verified restore is older
  # than VERIFY_EVERY_DAYS. verify-restore records its own success.
  STATUS="${BACKUP_DIR:-/backups}/backup-status.json"
  LAST_VERIFIED="$(sed -n 's/.*"lastVerifiedRestore"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${STATUS}" 2>/dev/null | head -n1)"
  DUE=1
  if [ -n "${LAST_VERIFIED}" ]; then
    VERIFIED_EPOCH="$(date -d "${LAST_VERIFIED}" +%s 2>/dev/null || echo 0)"
    AGE_DAYS="$(( ( $(date +%s) - VERIFIED_EPOCH ) / 86400 ))"
    [ "${AGE_DAYS}" -lt "${VERIFY_EVERY_DAYS}" ] && DUE=0
  fi
  if [ "${DUE}" -eq 1 ]; then
    echo "[backup-loop] running the weekly restore drill."
    bash /ops/verify-restore.sh || echo "[backup-loop] RESTORE DRILL FAILED — backups may not be restorable!" >&2
  fi
done
