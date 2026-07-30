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
