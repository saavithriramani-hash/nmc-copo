import 'server-only';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { ENGINE_VERSION } from '@copo/engine';
import { prisma } from './db';
import { storageRoot } from './bundle';
import { csvField } from './csv';

/**
 * Full institutional data export (NFR-12) — the college is never locked
 * in.
 *
 * Every table is written as CSV (RFC 4180, UTF-8) with a JSON manifest
 * describing the tables, their columns and the row counts, plus a README
 * a stranger can follow. Nothing is proprietary: any spreadsheet,
 * database or script can read the result.
 *
 * Large tables (MarkValue reaches tens of millions of rows) are streamed
 * in keyset-paginated batches straight to disk — the export never holds a
 * table in memory (NFR-1).
 */

const BATCH = 5000;

export const exportPath = (jobId: string): string => path.join(storageRoot(), 'exports', `${jobId}.zip`);
const workingDir = (jobId: string): string => path.join(storageRoot(), 'exports', jobId);

export interface ExportProgress {
  (done: number, total: number, note: string): Promise<void> | void;
}

export interface DataExportResult {
  fileName: string;
  tableCount: number;
  rowCount: number;
  byteLength: number;
  generatedAt: string;
}

/** Streams one table to CSV, ordered by a stable key, in batches. */
async function writeTable(
  dir: string,
  name: string,
  fetchPage: (skip: number, take: number) => Promise<Record<string, unknown>[]>,
): Promise<{ rows: number; columns: string[] }> {
  const file = path.join(dir, `${name}.csv`);
  const stream = createWriteStream(file, { encoding: 'utf8' });
  let columns: string[] = [];
  let rows = 0;
  let skip = 0;

  try {
    for (;;) {
      const page = await fetchPage(skip, BATCH);
      if (page.length === 0) break;
      if (rows === 0) {
        columns = Object.keys(page[0]!);
        stream.write(`${columns.join(',')}\n`);
      }
      for (const row of page) {
        stream.write(`${columns.map((column) => csvField(row[column])).join(',')}\n`);
      }
      rows += page.length;
      skip += page.length;
      if (page.length < BATCH) break;
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.end(resolve);
    });
  }
  // An empty table still gets a file, so the export is complete by shape.
  if (rows === 0) await writeFile(file, '');
  return { rows, columns };
}

export async function runDataExport(jobId: string, onProgress: ExportProgress): Promise<DataExportResult> {
  const dir = workingDir(jobId);
  await mkdir(dir, { recursive: true });

  // Ordered so a reader can rebuild the structure top-down. Each entry
  // pages with a stable order, so a long export cannot skip or repeat.
  const tables: { name: string; page: (skip: number, take: number) => Promise<Record<string, unknown>[]> }[] = [
    { name: 'institution', page: (skip, take) => prisma.institution.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'department', page: (skip, take) => prisma.department.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'programme', page: (skip, take) => prisma.programme.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'programme_outcome', page: (skip, take) => prisma.programmeOutcome.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'batch', page: (skip, take) => prisma.batch.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'student', page: (skip, take) => prisma.student.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'batch_roster', page: (skip, take) => prisma.batchRoster.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'course', page: (skip, take) => prisma.course.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'course_instructor', page: (skip, take) => prisma.courseInstructor.findMany({ skip, take, orderBy: [{ courseId: 'asc' }, { userId: 'asc' }] }) },
    { name: 'course_outcome', page: (skip, take) => prisma.courseOutcome.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'articulation_matrix', page: (skip, take) => prisma.articulationMatrix.findMany({ skip, take, orderBy: [{ coId: 'asc' }, { poId: 'asc' }] }) },
    { name: 'enrolment', page: (skip, take) => prisma.enrolment.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'assessment', page: (skip, take) => prisma.assessment.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'assessment_co_tag', page: (skip, take) => prisma.assessmentCoTag.findMany({ skip, take, orderBy: [{ assessmentId: 'asc' }, { coId: 'asc' }] }) },
    { name: 'section', page: (skip, take) => prisma.section.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'item', page: (skip, take) => prisma.item.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'mark_value', page: (skip, take) => prisma.markValue.findMany({ skip, take, orderBy: [{ enrolmentId: 'asc' }, { itemId: 'asc' }] }) },
    { name: 'indirect_feedback', page: (skip, take) => prisma.indirectFeedback.findMany({ skip, take, orderBy: { coId: 'asc' } }) },
    { name: 'assessment_template', page: (skip, take) => prisma.assessmentTemplate.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'attainment_snapshot', page: (skip, take) => prisma.attainmentSnapshot.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    // Accounts without password hashes: an export must not leak credentials.
    {
      name: 'user',
      page: (skip, take) =>
        prisma.user.findMany({
          skip,
          take,
          orderBy: { id: 'asc' },
          select: { id: true, email: true, fullName: true, identityProvider: true, isActive: true, createdAt: true, updatedAt: true },
        }),
    },
    { name: 'role', page: (skip, take) => prisma.role.findMany({ skip, take, orderBy: { id: 'asc' } }) },
    { name: 'audit_log', page: (skip, take) => prisma.auditLog.findMany({ skip, take, orderBy: { id: 'asc' } }) },
  ];

  const manifest: { table: string; file: string; rows: number; columns: string[] }[] = [];
  let rowCount = 0;

  for (const [index, table] of tables.entries()) {
    await onProgress(index, tables.length + 1, `Exporting ${table.name}`);
    const written = await writeTable(dir, table.name, table.page);
    manifest.push({ table: table.name, file: `${table.name}.csv`, rows: written.rows, columns: written.columns });
    rowCount += written.rows;
  }

  const generatedAt = new Date();
  await writeFile(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        generatedAt: generatedAt.toISOString(),
        engineVersion: ENGINE_VERSION,
        format: 'CSV (RFC 4180), UTF-8, comma-separated, first row is the header',
        nullConvention: 'An empty field is NULL. A mark of 0 is a real attempted mark and is written as 0.',
        tables: manifest,
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    path.join(dir, 'README.txt'),
    [
      'Full institutional data export — CO–PO attainment system',
      `Generated: ${generatedAt.toISOString()}`,
      '',
      'Every table is a CSV file in this archive: UTF-8, comma-separated, the first row',
      'is the column header, quoted per RFC 4180. manifest.json lists every table, its',
      'columns and its row count.',
      '',
      'IMPORTANT — blank is not zero.',
      '  An empty field means NULL, i.e. "no value". In mark_value.csv an empty "value"',
      '  means the student DID NOT ATTEMPT that item, and it is excluded from attainment',
      '  denominators. A value of 0 means the student attempted and scored nothing, and',
      '  it IS included. Any tool that reads this data must preserve that distinction.',
      '',
      'Passwords are deliberately not exported. attainment_snapshot.csv contains the',
      'immutable record of every locked course, including the exact engine input and',
      'result, so past figures can be reproduced without this application.',
      '',
      'These are open formats. No part of this export requires the original software.',
      '',
    ].join('\n'),
  );

  await onProgress(tables.length, tables.length + 1, 'Assembling the archive');
  const zipPath = exportPath(jobId);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dir, false);
    void archive.finalize();
  });

  const zipStat = await stat(zipPath);
  return {
    fileName: `COPO_Institutional_Export_${generatedAt.toISOString().slice(0, 10)}.zip`,
    tableCount: tables.length,
    rowCount,
    byteLength: zipStat.size,
    generatedAt: generatedAt.toISOString(),
  };
}
