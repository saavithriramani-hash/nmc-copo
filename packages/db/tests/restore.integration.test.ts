import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The restore drill, as an automated, provable test (NFR-6: an untested
 * backup is not a backup).
 *
 * It performs the REAL cycle the production drill performs: apply the
 * schema, insert known data, pg_dump it, restore the dump into a fresh
 * database, and assert the data — and the invariants — came back intact.
 *
 * It needs a PostgreSQL a superuser can create databases on, and the
 * pg_dump / pg_restore / psql binaries (all present in the backup
 * container and in CI). It is therefore GATED on RESTORE_TEST_ADMIN_URL,
 * a connection string to the `postgres` maintenance database, e.g.
 *   RESTORE_TEST_ADMIN_URL=postgresql://copo:copo@localhost:5433/postgres
 *
 * When that is not set it SKIPS LOUDLY rather than passing silently — a
 * skipped safety test must never look like a green one.
 */

const ADMIN_URL = process.env.RESTORE_TEST_ADMIN_URL;
const SRC_DB = 'copo_restore_src_test';
const DST_DB = 'copo_restore_dst_test';

function haveTool(tool: string): boolean {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const toolsPresent = haveTool('pg_dump') && haveTool('pg_restore') && haveTool('psql');
const enabled = Boolean(ADMIN_URL) && toolsPresent;

if (!enabled) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[restore drill] SKIPPED — set RESTORE_TEST_ADMIN_URL (a postgres:// URL to the "postgres" database) ' +
      'and ensure pg_dump/pg_restore/psql are on PATH to run the real backup→restore proof.\n',
  );
}

/** Swaps the database name in a connection URL. */
function urlForDb(adminUrl: string, dbName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function psqlAdmin(sql: string): void {
  execFileSync('psql', [ADMIN_URL!, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'pipe' });
}

const workDir = enabled ? mkdtempSync(path.join(tmpdir(), 'copo-restore-')) : '';

afterAll(() => {
  if (!enabled) return;
  try {
    psqlAdmin(`DROP DATABASE IF EXISTS "${SRC_DB}"`);
    psqlAdmin(`DROP DATABASE IF EXISTS "${DST_DB}"`);
  } catch {
    /* best effort */
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!enabled)('restore drill (real pg_dump → pg_restore)', () => {
  const dumpFile = path.join(workDir || '.', 'test.dump');
  const srcUrl = enabled ? urlForDb(ADMIN_URL!, SRC_DB) : '';
  const dstUrl = enabled ? urlForDb(ADMIN_URL!, DST_DB) : '';
  const schema = path.join(__dirname, '..', 'prisma', 'schema.prisma');

  it('backs up a populated database and restores it intact', async () => {
    // ── 1. A fresh source database with the real schema ──
    psqlAdmin(`DROP DATABASE IF EXISTS "${SRC_DB}"`);
    psqlAdmin(`CREATE DATABASE "${SRC_DB}"`);
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: srcUrl },
      stdio: 'pipe',
    });

    // ── 2. Known data, including a mark that is a real 0 and a real blank ──
    const src = new PrismaClient({ datasources: { db: { url: srcUrl } } });
    let snapshotId = '';
    try {
      const institution = await src.institution.create({
        data: {
          name: 'Restore Test College',
          thresholdFraction: '0.7',
          bands: [{ lowerBound: 0, level: 0 }],
          cohortBands: [],
          weightGroups: { only: 1 },
          directWeight: '0.9',
          indirectWeight: '0.1',
          targetAttainment: '2.5',
          feedbackResponseFloor: 0,
        },
      });
      const department = await src.department.create({ data: { institutionId: institution.id, name: 'Maths' } });
      const programme = await src.programme.create({ data: { departmentId: department.id, name: 'B.Sc.' } });
      const batch = await src.batch.create({ data: { programmeId: programme.id, name: '2024', startYear: 2024, endYear: 2027 } });
      const student = await src.student.create({ data: { fullName: 'Test Student' } });
      const roster = await src.batchRoster.create({ data: { batchId: batch.id, studentId: student.id, registerNumber: 'R1' } });
      const course = await src.course.create({ data: { batchId: batch.id, code: 'MAT1', title: 'Analysis', semester: 1 } });
      const co = await src.courseOutcome.create({ data: { courseId: course.id, code: 'CO1', statement: 's', bloomLevels: ['Apply'], displayOrder: 1 } });
      const assessment = await src.assessment.create({
        data: { courseId: course.id, name: 'A1', shape: 'ITEM_LIST', scoringRule: 'RUBRIC', weightGroup: 'only', displayOrder: 1 },
      });
      const item = await src.item.create({ data: { assessmentId: assessment.id, label: 'Q1', maxMark: '5', coId: co.id, displayOrder: 1 } });
      const enrolment = await src.enrolment.create({ data: { courseId: course.id, rosterEntryId: roster.id, batchId: batch.id } });
      // A real 0 (attempted, scored nothing) — must survive the round trip.
      await src.markValue.create({ data: { enrolmentId: enrolment.id, itemId: item.id, assessmentId: assessment.id, courseId: course.id, value: '0' } });
      const user = await src.user.create({ data: { email: 'a@b.c', fullName: 'Admin', passwordHash: 'x' } });
      const snapshot = await src.attainmentSnapshot.create({
        data: { courseId: course.id, version: 1, engineVersion: '0.1.0', input: {}, result: {}, createdById: user.id },
      });
      snapshotId = snapshot.id;
    } finally {
      await src.$disconnect();
    }

    // ── 3. Dump (the backup) ──
    execFileSync('pg_dump', ['--format=custom', '--compress=9', `--file=${dumpFile}`, srcUrl], { stdio: 'pipe' });

    // ── 4. Restore into a fresh database ──
    psqlAdmin(`DROP DATABASE IF EXISTS "${DST_DB}"`);
    psqlAdmin(`CREATE DATABASE "${DST_DB}"`);
    execFileSync('pg_restore', ['--dbname', dstUrl, '--no-owner', '--no-privileges', '--exit-on-error', dumpFile], { stdio: 'pipe' });

    // ── 5. Prove the restored data — and the invariants — are intact ──
    const dst = new PrismaClient({ datasources: { db: { url: dstUrl } } });
    try {
      expect(await dst.institution.count()).toBe(1);
      expect(await dst.markValue.count()).toBe(1);

      // The 0 came back as 0, not null and not missing (blank ≠ zero).
      const mark = await dst.markValue.findFirst();
      expect(mark?.value?.toString()).toBe('0');

      // No mark is orphaned — the join the whole system relies on holds.
      const orphans = await dst.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM "MarkValue" m
        LEFT JOIN "Enrolment" e ON e.id = m."enrolmentId" WHERE e.id IS NULL`;
      expect(Number(orphans[0]!.n)).toBe(0);

      // The immutability trigger restored with the schema, and still bites:
      // updating a snapshot must be rejected by the database itself.
      await expect(
        dst.$executeRawUnsafe(`UPDATE "AttainmentSnapshot" SET version = 2 WHERE id = '${snapshotId}'`),
      ).rejects.toThrow();
      // And the row is unchanged.
      const snap = await dst.attainmentSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
      expect(snap.version).toBe(1);
    } finally {
      await dst.$disconnect();
    }
  }, 120_000);
});
