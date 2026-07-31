import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the operations scripts. These run unattended on the college
 * server, so this test — which runs everywhere, with no database — makes
 * sure the safety-critical parts cannot be quietly removed. It is the
 * always-on companion to the gated restore drill.
 */

const opsDir = path.join(__dirname, '..', '..', '..', 'ops');
const read = (name: string): string => readFileSync(path.join(opsDir, name), 'utf8');

describe('verify-restore.sh — the drill that proves backups are restorable', () => {
  const script = read('verify-restore.sh');

  it('actually restores a dump with pg_restore', () => {
    expect(script).toMatch(/pg_restore/);
    expect(script).toMatch(/--exit-on-error/); // any dump error fails the drill
  });

  it('checks the restored data is coherent, not merely present', () => {
    expect(script).toContain('MarkValue'); // core table must exist
    expect(script).toContain('orphaned marks'); // referential integrity
    expect(script).toContain('AttainmentSnapshot_immutable'); // the trigger survived
  });

  it('never touches the live database — it restores into a scratch DB and drops it', () => {
    expect(script).toContain('copo_restore_check');
    expect(script).toMatch(/DROP DATABASE IF EXISTS/);
    expect(script).toMatch(/trap cleanup EXIT/);
  });

  it('records its result for the health page', () => {
    expect(script).toContain('lastVerifiedRestore');
  });
});

describe('backup.sh — the nightly dump', () => {
  const script = read('backup.sh');

  it('writes a restorable custom-format dump and renames only when complete', () => {
    expect(script).toMatch(/pg_dump.*--format=custom/s);
    expect(script).toContain('.partial'); // no half-written file with a valid name
  });

  it('copies to the second location on campus when configured', () => {
    expect(script).toContain('BACKUP_SECONDARY_DIR');
  });

  it('prunes on a policy that keeps monthly dumps for years, not days', () => {
    expect(script).toContain('KEEP_MONTHLY_DAYS');
  });

  it('records success and size for the health page', () => {
    expect(script).toContain('lastSuccess');
    expect(script).toContain('backup-status.json');
  });
});

describe('upgrade.sh — safe by construction', () => {
  const script = read('upgrade.sh');

  it('takes a backup BEFORE changing anything and refuses to continue if it fails', () => {
    const backupAt = script.indexOf('backup.sh');
    const buildAt = script.indexOf('compose build');
    expect(backupAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(backupAt); // build happens after the safety backup
    expect(script).toMatch(/not upgrading/i);
  });

  it('tells the operator how to roll back', () => {
    expect(script.toLowerCase()).toContain('roll back');
  });
});

describe('deploy.sh — one command, no destructive surprises', () => {
  const script = read('deploy.sh');
  it('refuses to run with the placeholder password', () => {
    expect(script).toContain('CHANGE_ME_TO_A_LONG_RANDOM_STRING');
  });
  it('creates the first administrator through the self-locking bootstrap route', () => {
    expect(script).toContain('/api/bootstrap/admin');
    expect(script).toContain('BOOTSTRAP_TOKEN');
  });
});

describe('cleanup.sh — nightly housekeeping that must never eat the record', () => {
  const script = read('cleanup.sh');

  it('NEVER touches the audit log, the marks, or the snapshots', () => {
    // The whole risk of an unattended delete script is that it one day
    // removes the thing an accreditation auditor asks for. These three
    // are the record; nothing here may issue a DELETE against them.
    for (const table of ['AuditLog', 'MarkValue', 'AttainmentSnapshot']) {
      expect(script, table).not.toMatch(new RegExp(`DELETE\s+FROM\s+"${table}"`, 'i'));
    }
  });

  it('offers no retention setting for the audit log, so none can be set by mistake', () => {
    expect(script).not.toMatch(/KEEP_AUDIT/i);
    // …and says why, where the next person will look.
    expect(script).toMatch(/AuditLog/);
    expect(script.toLowerCase()).toMatch(/never/);
  });

  it('deletes only jobs that have actually finished', () => {
    // A PENDING or RUNNING row may be a live job, and NFR-4 restarts a
    // job from its row — deleting one mid-flight would strand it.
    expect(script).toMatch(/DELETE FROM "Job"/);
    expect(script).toMatch(/status IN \('COMPLETED', 'FAILED'\)/);
    expect(script).toMatch(/"finishedAt" IS NOT NULL/);
  });

  it('deletes only sessions that can no longer authenticate anyone', () => {
    expect(script).toMatch(/DELETE FROM "Session"/);
    expect(script).toMatch(/"revokedAt" IS NOT NULL/);
    expect(script).toMatch(/"expiresAt" </);
  });

  it('removes bundle working DIRECTORIES only, never the .zip deliverable', () => {
    expect(script).toMatch(/-type d/);
    expect(script).toMatch(/-mtime "\+\$\{KEEP_BUNDLE_WORKDIR_DAYS\}"/);
    // A bare rm of the bundles folder, or of the zips, would destroy
    // accreditation output that was never downloaded. The script may
    // TALK about .zip files — it explains why it leaves them — but no
    // delete may name one.
    expect(script).not.toMatch(/rm -rf "?\$\{STORAGE_DIR\}\/bundles"?\s*$/m);
    for (const line of script.split('\n')) {
      if (line.trimStart().startsWith('#')) continue;
      if (!/\.zip/.test(line)) continue;
      expect(line, 'no delete may name a .zip').not.toMatch(/\brm\b|-delete|unlink/);
    }
  });

  it('fails loudly rather than silently deleting against the wrong database', () => {
    expect(script).toMatch(/PGHOST:\?/);
    expect(script).toMatch(/PGDATABASE:\?/);
    expect(script).toMatch(/ON_ERROR_STOP=1/);
  });

  it('every retention window is configurable and has a default', () => {
    for (const setting of ['KEEP_BUNDLE_WORKDIR_DAYS', 'KEEP_JOB_DAYS', 'KEEP_EXPIRED_SESSION_DAYS']) {
      expect(script, setting).toMatch(new RegExp(`${setting}:-\\d+`));
    }
  });
});

describe('backup-loop.sh — housekeeping is subordinate to backups', () => {
  const script = read('backup-loop.sh');

  it('runs cleanup AFTER the backup, so the dump predates any deletion', () => {
    const backupAt = script.indexOf('/ops/backup.sh');
    const cleanupAt = script.indexOf('/ops/cleanup.sh');
    expect(cleanupAt).toBeGreaterThan(-1);
    expect(cleanupAt).toBeGreaterThan(backupAt);
  });

  it('never lets a cleanup failure stop the nightly loop', () => {
    expect(script).toMatch(/cleanup\.sh \|\| echo/);
  });
});
