import { describe, expect, it } from 'vitest';
import {
  classifyBackupAge,
  classifyDisk,
  classifyJobs,
  classifyRestoreDrill,
  classifySecondaryCopy,
  formatBytes,
  worst,
  type JobSnapshot,
} from '../lib/healthRules';

const NOW = new Date('2026-07-24T09:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('worst', () => {
  it('reports the most severe level present', () => {
    expect(worst(['ok', 'ok'])).toBe('ok');
    expect(worst(['ok', 'warn'])).toBe('warn');
    expect(worst(['warn', 'fail', 'ok'])).toBe('fail');
    expect(worst([])).toBe('ok');
  });
});

describe('classifyBackupAge', () => {
  it('a backup from last night is fine', () => {
    expect(classifyBackupAge(hoursAgo(8), NOW).level).toBe('ok');
  });

  it('warns once the nightly backup is late, fails once two nights are missed', () => {
    expect(classifyBackupAge(hoursAgo(25), NOW).level).toBe('ok');
    expect(classifyBackupAge(hoursAgo(26), NOW).level).toBe('warn');
    expect(classifyBackupAge(hoursAgo(49), NOW).level).toBe('warn');
    expect(classifyBackupAge(hoursAgo(50), NOW).level).toBe('fail');
  });

  it('never having backed up is a failure, with an action to take', () => {
    const finding = classifyBackupAge(null, NOW);
    expect(finding.level).toBe('fail');
    expect(finding.action).toContain('docker compose logs backup');
  });
});

describe('classifyRestoreDrill — an untested backup is not a backup', () => {
  it('warns when no drill has ever run', () => {
    const finding = classifyRestoreDrill(null, NOW);
    expect(finding.level).toBe('warn');
    expect(finding.action).toContain('verify-restore.sh');
  });

  it('is fine within five weeks and warns beyond', () => {
    expect(classifyRestoreDrill(daysAgo(7), NOW).level).toBe('ok');
    expect(classifyRestoreDrill(daysAgo(34), NOW).level).toBe('ok');
    expect(classifyRestoreDrill(daysAgo(35), NOW).level).toBe('warn');
  });
});

describe('classifySecondaryCopy — the second location on campus', () => {
  it('warns when no second location is configured', () => {
    expect(classifySecondaryCopy(false, null, NOW).level).toBe('warn');
  });

  it('fails when configured but nothing has been written there', () => {
    expect(classifySecondaryCopy(true, null, NOW).level).toBe('fail');
  });

  it('fails when the copy has gone stale — the share is probably unmounted', () => {
    expect(classifySecondaryCopy(true, hoursAgo(10), NOW).level).toBe('ok');
    expect(classifySecondaryCopy(true, hoursAgo(60), NOW).level).toBe('fail');
  });
});

describe('classifyDisk', () => {
  const GB = 1024 ** 3;

  it('is fine with plenty of room', () => {
    expect(classifyDisk('Backups', 200 * GB, 500 * GB).level).toBe('ok');
  });

  it('warns below 20% and fails below 10%', () => {
    expect(classifyDisk('Backups', 90 * GB, 500 * GB).level).toBe('warn'); // 18%
    expect(classifyDisk('Backups', 40 * GB, 500 * GB).level).toBe('fail'); // 8%
  });

  it('applies an absolute floor too — 15% of a small disk is still too little', () => {
    // 1.5 GB free of 10 GB is 15%: above the fail percentage, below the
    // absolute fail floor of 2 GB.
    expect(classifyDisk('Backups', 1.5 * GB, 10 * GB).level).toBe('fail');
    // 4 GB of 20 GB is 20%, but under the 5 GB warn floor.
    expect(classifyDisk('Backups', 4 * GB, 20 * GB).level).toBe('warn');
  });

  it('reports an unreadable volume rather than pretending it is empty', () => {
    expect(classifyDisk('Backups', 0, 0).level).toBe('warn');
  });

  it('formats sizes for a human reader', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB');
  });
});

describe('classifyJobs', () => {
  const job = (over: Partial<JobSnapshot>): JobSnapshot => ({
    id: 'j',
    kind: 'ACCREDITATION_BUNDLE',
    status: 'COMPLETED',
    startedAt: hoursAgo(1),
    finishedAt: hoursAgo(1),
    error: null,
    ...over,
  });

  it('is quiet when nothing is running or recently failed', () => {
    expect(classifyJobs([job({})], NOW).level).toBe('ok');
    expect(classifyJobs([], NOW).level).toBe('ok');
  });

  it('reports normal running jobs as ok', () => {
    expect(classifyJobs([job({ status: 'RUNNING', startedAt: hoursAgo(1) })], NOW).level).toBe('ok');
  });

  it('fails on a job stuck for more than six hours, and says why', () => {
    const finding = classifyJobs([job({ status: 'RUNNING', startedAt: hoursAgo(7) })], NOW);
    expect(finding.level).toBe('fail');
    expect(finding.action).toContain('resume');
  });

  it('warns on a job that failed in the last day, but not on older ones', () => {
    expect(classifyJobs([job({ status: 'FAILED', finishedAt: hoursAgo(3) })], NOW).level).toBe('warn');
    expect(classifyJobs([job({ status: 'FAILED', finishedAt: hoursAgo(30) })], NOW).level).toBe('ok');
  });

  it('a stuck job outranks a merely failed one', () => {
    const finding = classifyJobs(
      [job({ status: 'FAILED', finishedAt: hoursAgo(3) }), job({ status: 'RUNNING', startedAt: hoursAgo(9) })],
      NOW,
    );
    expect(finding.level).toBe('fail');
  });
});
