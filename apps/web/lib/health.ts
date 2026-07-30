import 'server-only';
import { readFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';
import { storageRoot } from './bundle';
import {
  classifyBackupAge,
  classifyDisk,
  classifyJobs,
  classifyRestoreDrill,
  classifySecondaryCopy,
  worst,
  type Finding,
  type JobSnapshot,
  type Level,
} from './healthRules';

/**
 * The health check behind /admin/health and /api/health.
 *
 * It answers the four questions an operator actually has: can the
 * application reach the database, when did a backup last succeed (and was
 * it ever proven restorable), is there room on disk, and are the
 * background jobs healthy. Every finding carries the command to run next,
 * because the person reading it may never have seen this system before.
 */

export const backupDir = (): string => process.env.BACKUP_DIR ?? '/backups';
const statusFile = (): string => path.join(backupDir(), 'backup-status.json');

/** Written by the backup sidecar after every run. */
interface BackupStatus {
  lastAttempt?: string;
  lastSuccess?: string;
  lastError?: string | null;
  lastSizeBytes?: number;
  lastDurationSeconds?: number;
  lastSecondaryCopy?: string;
  secondaryConfigured?: boolean;
  lastVerifiedRestore?: string;
  dumpCount?: number;
}

async function readBackupStatus(): Promise<BackupStatus | null> {
  try {
    return JSON.parse(await readFile(statusFile(), 'utf8')) as BackupStatus;
  } catch {
    return null;
  }
}

async function diskFinding(label: string, dir: string): Promise<Finding> {
  try {
    const stats = await statfs(dir);
    const total = Number(stats.blocks) * Number(stats.bsize);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return classifyDisk(label, free, total);
  } catch {
    return {
      level: 'warn',
      summary: `${label}: could not read ${dir}.`,
      action: 'Check that the volume is mounted into the application container.',
    };
  }
}

export interface HealthReport {
  level: Level;
  checkedAt: string;
  checks: { name: string; finding: Finding }[];
  details: {
    databaseLatencyMs: number | null;
    lastBackup: string | null;
    lastVerifiedRestore: string | null;
    lastBackupSizeBytes: number | null;
    dumpCount: number | null;
    runningJobs: number;
    failedJobs24h: number;
  };
}

export async function collectHealth(now = new Date()): Promise<HealthReport> {
  // ── database ──
  let databaseLatencyMs: number | null = null;
  let database: Finding;
  try {
    const started = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    databaseLatencyMs = Date.now() - started;
    database =
      databaseLatencyMs > 2000
        ? {
            level: 'warn',
            summary: `Database reachable but slow (${databaseLatencyMs} ms).`,
            action: 'Check server load, and whether a large background job is running.',
          }
        : { level: 'ok', summary: `Database reachable (${databaseLatencyMs} ms).` };
  } catch (err) {
    database = {
      level: 'fail',
      summary: `Cannot reach the database: ${err instanceof Error ? err.message : String(err)}`,
      action: 'Check the database container: docker compose ps, then docker compose logs db',
    };
  }

  // ── backups ──
  const status = await readBackupStatus();
  const lastSuccess = status?.lastSuccess ? new Date(status.lastSuccess) : null;
  const lastVerified = status?.lastVerifiedRestore ? new Date(status.lastVerifiedRestore) : null;
  const lastSecondary = status?.lastSecondaryCopy ? new Date(status.lastSecondaryCopy) : null;

  const backup = classifyBackupAge(lastSuccess, now);
  const drill = classifyRestoreDrill(lastVerified, now);
  const secondary = classifySecondaryCopy(status?.secondaryConfigured ?? false, lastSecondary, now);

  // ── disk ──
  const [backupDisk, storageDisk] = await Promise.all([
    diskFinding('Backup volume', backupDir()),
    diskFinding('Application storage', storageRoot()),
  ]);

  // ── background jobs ──
  const recentJobs = await prisma.job.findMany({
    where: { OR: [{ status: 'RUNNING' }, { status: 'PENDING' }, { finishedAt: { gte: new Date(now.getTime() - 86_400_000) } }] },
    select: { id: true, kind: true, status: true, startedAt: true, finishedAt: true, error: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const snapshots: JobSnapshot[] = recentJobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
  }));
  const jobs = classifyJobs(snapshots, now);

  const checks = [
    { name: 'Database', finding: database },
    { name: 'Nightly backup', finding: backup },
    { name: 'Restore drill', finding: drill },
    { name: 'Second copy on campus', finding: secondary },
    { name: 'Backup volume', finding: backupDisk },
    { name: 'Application storage', finding: storageDisk },
    { name: 'Background jobs', finding: jobs },
  ];

  return {
    level: worst(checks.map((check) => check.finding.level)),
    checkedAt: now.toISOString(),
    checks,
    details: {
      databaseLatencyMs,
      lastBackup: status?.lastSuccess ?? null,
      lastVerifiedRestore: status?.lastVerifiedRestore ?? null,
      lastBackupSizeBytes: status?.lastSizeBytes ?? null,
      dumpCount: status?.dumpCount ?? null,
      runningJobs: snapshots.filter((job) => job.status === 'RUNNING').length,
      failedJobs24h: snapshots.filter((job) => job.status === 'FAILED').length,
    },
  };
}
