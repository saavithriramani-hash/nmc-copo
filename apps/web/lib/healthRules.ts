/**
 * Health classification rules — pure, unit-tested.
 *
 * Kept apart from the checks that touch the database and the filesystem
 * so the thresholds an operator relies on can be verified without a
 * running system. Every rule answers one question in plain language,
 * because the person reading the health page may not be a specialist.
 */

export type Level = 'ok' | 'warn' | 'fail';

export interface Finding {
  level: Level;
  /** One line, written for a non-specialist. */
  summary: string;
  /** What to do about it, when it is not ok. */
  action?: string;
}

/** The worst level present — the page's overall verdict. */
export function worst(levels: Level[]): Level {
  if (levels.includes('fail')) return 'fail';
  if (levels.includes('warn')) return 'warn';
  return 'ok';
}

// ── backups ──────────────────────────────────────────────────────────────

export const BACKUP_WARN_HOURS = 26; // a nightly backup is late
export const BACKUP_FAIL_HOURS = 50; // two nights missed

export function classifyBackupAge(lastSuccess: Date | null, now: Date): Finding {
  if (lastSuccess === null) {
    return {
      level: 'fail',
      summary: 'No successful backup has ever been recorded.',
      action: 'Check the backup container: docker compose logs backup',
    };
  }
  const hours = (now.getTime() - lastSuccess.getTime()) / 3_600_000;
  const when = lastSuccess.toISOString().replace('T', ' ').slice(0, 16);
  if (hours >= BACKUP_FAIL_HOURS) {
    return {
      level: 'fail',
      summary: `Last successful backup was ${Math.floor(hours)} hours ago (${when}).`,
      action: 'At least two nightly backups have been missed. Check: docker compose logs backup',
    };
  }
  if (hours >= BACKUP_WARN_HOURS) {
    return {
      level: 'warn',
      summary: `Last successful backup was ${Math.floor(hours)} hours ago (${when}).`,
      action: 'The nightly backup is late. Check: docker compose logs backup',
    };
  }
  return { level: 'ok', summary: `Last successful backup ${when} (${Math.floor(hours)} hours ago).` };
}

/**
 * The restore drill. A backup nobody has restored is not a backup, so a
 * drill that has never run, or has not run in five weeks, is a warning in
 * its own right.
 */
export const DRILL_WARN_DAYS = 35;

export function classifyRestoreDrill(lastVerified: Date | null, now: Date): Finding {
  if (lastVerified === null) {
    return {
      level: 'warn',
      summary: 'No restore drill has been recorded yet.',
      action: 'Run ops/verify-restore.sh — it restores the latest backup into a scratch database and checks it.',
    };
  }
  const days = (now.getTime() - lastVerified.getTime()) / 86_400_000;
  const when = lastVerified.toISOString().slice(0, 10);
  if (days >= DRILL_WARN_DAYS) {
    return {
      level: 'warn',
      summary: `Last successful restore drill was ${Math.floor(days)} days ago (${when}).`,
      action: 'Run ops/verify-restore.sh to prove the backups can still be restored.',
    };
  }
  return { level: 'ok', summary: `Backups proven restorable on ${when} (${Math.floor(days)} days ago).` };
}

/** The second on-campus copy required by NFR-6. */
export function classifySecondaryCopy(configured: boolean, lastCopy: Date | null, now: Date): Finding {
  if (!configured) {
    return {
      level: 'warn',
      summary: 'No second backup location is configured.',
      action: 'Set BACKUP_SECONDARY_DIR to a share on another machine on campus, then restart the backup container.',
    };
  }
  if (lastCopy === null) {
    return {
      level: 'fail',
      summary: 'A second location is configured but nothing has been copied there.',
      action: 'The share is probably not mounted or not writable. Check: docker compose logs backup',
    };
  }
  const hours = (now.getTime() - lastCopy.getTime()) / 3_600_000;
  if (hours >= BACKUP_FAIL_HOURS) {
    return {
      level: 'fail',
      summary: `The second copy is ${Math.floor(hours)} hours old.`,
      action: 'The campus share may be unreachable. Check that it is still mounted.',
    };
  }
  return { level: 'ok', summary: `Second on-campus copy written ${lastCopy.toISOString().slice(0, 16).replace('T', ' ')}.` };
}

// ── disk ─────────────────────────────────────────────────────────────────

export const DISK_WARN_PERCENT = 20;
export const DISK_FAIL_PERCENT = 10;
export const DISK_WARN_BYTES = 5 * 1024 ** 3;
export const DISK_FAIL_BYTES = 2 * 1024 ** 3;

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

/**
 * Disk headroom. Both a percentage and an absolute floor: 10% of a small
 * volume can still be too little to write a dump into.
 */
export function classifyDisk(label: string, freeBytes: number, totalBytes: number): Finding {
  if (totalBytes <= 0) {
    return { level: 'warn', summary: `${label}: size could not be read.`, action: 'Check that the volume is mounted.' };
  }
  const percent = (freeBytes / totalBytes) * 100;
  const summary = `${label}: ${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)} (${percent.toFixed(0)}%).`;
  if (percent < DISK_FAIL_PERCENT || freeBytes < DISK_FAIL_BYTES) {
    return { level: 'fail', summary, action: 'Free space now — backups and mark entry will start failing. Delete old bundles under storage/, or extend the volume.' };
  }
  if (percent < DISK_WARN_PERCENT || freeBytes < DISK_WARN_BYTES) {
    return { level: 'warn', summary, action: 'Plan to free space or extend the volume.' };
  }
  return { level: 'ok', summary };
}

// ── background jobs ──────────────────────────────────────────────────────

export const JOB_STUCK_HOURS = 6;

export interface JobSnapshot {
  id: string;
  kind: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

export function classifyJobs(jobs: JobSnapshot[], now: Date): Finding {
  const running = jobs.filter((job) => job.status === 'RUNNING');
  const stuck = running.filter(
    (job) => job.startedAt !== null && now.getTime() - job.startedAt.getTime() > JOB_STUCK_HOURS * 3_600_000,
  );
  const failed = jobs.filter(
    (job) => job.status === 'FAILED' && job.finishedAt !== null && now.getTime() - job.finishedAt.getTime() < 24 * 3_600_000,
  );

  if (stuck.length > 0) {
    return {
      level: 'fail',
      summary: `${stuck.length} background job(s) have been running for over ${JOB_STUCK_HOURS} hours.`,
      action: 'They were probably interrupted by a restart. Restart the application; bundles resume from where they stopped.',
    };
  }
  if (failed.length > 0) {
    return {
      level: 'warn',
      summary: `${failed.length} background job(s) failed in the last 24 hours.`,
      action: 'Open the job on its page and restart it. Accreditation bundles resume rather than starting again.',
    };
  }
  if (running.length > 0) {
    return { level: 'ok', summary: `${running.length} background job(s) running normally.` };
  }
  return { level: 'ok', summary: 'No background jobs are running or recently failed.' };
}
