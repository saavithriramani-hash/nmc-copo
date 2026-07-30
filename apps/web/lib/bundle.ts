import 'server-only';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { ENGINE_VERSION } from '@copo/engine';
import type { Parameters as EngineParameters, ParameterSource } from '@copo/engine';
import {
  applyFilter,
  renderAppendix,
  renderCourseReport,
  renderInstitutionConsolidation,
  renderProgrammeConsolidation,
} from '@copo/report';
import { prisma } from './db';
import {
  buildInstitutionConsolidation,
  buildProgrammeConsolidation,
  institutionCourses,
  loadCourseReportData,
} from './reportData';

/**
 * The accreditation bundle (FR-22): every course report, the programme
 * and institution consolidations, and the Procedure appendix populated
 * with the parameters actually used — as one ZIP.
 *
 * RESTARTABLE (NFR-4). Each PDF is written to a working directory named
 * for the job before anything is zipped, and a re-run skips any file
 * already present. A bundle killed after 400 of 700 courses resumes at
 * 401 rather than starting again. The ZIP is only assembled once every
 * part exists, so a half-written archive can never be served.
 */

export const storageRoot = (): string => process.env.COPO_STORAGE_DIR ?? path.join(process.cwd(), 'storage');
const workingDir = (jobId: string): string => path.join(storageRoot(), 'bundles', jobId);
export const bundlePath = (jobId: string): string => path.join(storageRoot(), 'bundles', `${jobId}.zip`);

const safe = (value: string): string => value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'untitled';

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Writes the file unless it is already there — the resume primitive. */
async function writeOnce(file: string, produce: () => Promise<Buffer>): Promise<boolean> {
  if (await exists(file)) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await produce());
  return true;
}

export interface BundleProgress {
  (done: number, total: number, note: string): Promise<void> | void;
}

export interface BundleResult {
  zipPath: string;
  fileName: string;
  courseCount: number;
  programmeCount: number;
  skipped: number;
  byteLength: number;
  generatedAt: string;
}

export async function runBundle(
  jobId: string,
  filter: { semester?: number; batchName?: string },
  onProgress: BundleProgress,
): Promise<BundleResult> {
  const work = workingDir(jobId);
  await mkdir(work, { recursive: true });

  const institution = await prisma.institution.findFirst({ select: { name: true } });
  const institutionName = institution?.name ?? 'Institution';

  let courses = await institutionCourses();
  if (filter.semester !== undefined) courses = courses.filter((course) => course.semester === filter.semester);
  if (filter.batchName !== undefined) courses = courses.filter((course) => course.batchName === filter.batchName);

  const programmes = await prisma.programme.findMany({
    select: { id: true, name: true, department: { select: { name: true } } },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
  });

  // Total steps: courses + programme consolidations + institution + appendix + zip.
  const total = courses.length + programmes.length + 2;
  let done = 0;
  let skipped = 0;

  // ── 1. Course reports, and the parameters each actually used ──
  const appendixCourses: {
    code: string;
    title: string;
    programmeName: string;
    parameters: EngineParameters;
    provenance: Record<keyof EngineParameters, ParameterSource> | null;
  }[] = [];

  for (const course of courses) {
    const file = path.join(
      work,
      'Courses',
      safe(course.departmentName),
      safe(course.programmeName),
      `${safe(course.code)}.pdf`,
    );
    await onProgress(done, total, `Course report ${course.code}`);
    try {
      const data = await loadCourseReportData(course.id);
      appendixCourses.push({
        code: data.course.code,
        title: data.course.title,
        programmeName: data.course.programmeName,
        parameters: data.result.parameters,
        provenance: data.provenance,
      });
      const written = await writeOnce(file, () => renderCourseReport(data));
      if (!written) skipped += 1;
    } catch (err) {
      // A course that cannot be reported records the reason and the
      // bundle continues — one broken course must not sink the filing.
      const note = path.join(work, 'Courses', '_failed', `${safe(course.code)}.txt`);
      await mkdir(path.dirname(note), { recursive: true });
      await writeFile(note, `${course.code} — ${course.title}\n\n${err instanceof Error ? err.stack : String(err)}\n`);
    }
    done += 1;
  }

  // ── 2. Programme consolidations ──
  for (const programme of programmes) {
    await onProgress(done, total, `Consolidation ${programme.name}`);
    const file = path.join(work, 'Consolidations', `${safe(programme.department.name)}_${safe(programme.name)}.pdf`);
    const written = await writeOnce(file, async () => {
      const data = await buildProgrammeConsolidation(programme.id, filter);
      data.rows = applyFilter(data.rows, filter);
      return renderProgrammeConsolidation(data);
    });
    if (!written) skipped += 1;
    done += 1;
  }

  // ── 3. Institution consolidation ──
  await onProgress(done, total, 'Institution consolidation');
  const institutionFile = path.join(work, 'Consolidations', '00_Institution.pdf');
  if (!(await writeOnce(institutionFile, async () => {
    const data = await buildInstitutionConsolidation(filter);
    data.rows = applyFilter(data.rows, filter);
    return renderInstitutionConsolidation(data);
  }))) {
    skipped += 1;
  }
  done += 1;

  // ── 4. Procedure appendix, populated with the parameters actually used ──
  await onProgress(done, total, 'Procedure appendix');
  const appendixFile = path.join(work, 'Appendix', 'Procedure_and_Parameters.pdf');
  if (!(await writeOnce(appendixFile, () =>
    renderAppendix({
      institutionName,
      generatedAt: new Date(),
      engineVersion: ENGINE_VERSION,
      courses: appendixCourses,
    }),
  ))) {
    skipped += 1;
  }
  done += 1;

  // ── 5. A manifest, so the filed bundle explains itself ──
  const generatedAt = new Date();
  const manifest = [
    `${institutionName} — CO–PO/PSO accreditation bundle`,
    `Generated: ${generatedAt.toISOString()}`,
    `Engine version: ${ENGINE_VERSION}`,
    `Scope: ${filter.semester !== undefined ? `semester ${filter.semester}` : 'all semesters'}, ${
      filter.batchName !== undefined ? `batch ${filter.batchName}` : 'all batches'
    }`,
    '',
    `Course reports: ${courses.length}`,
    `Programme consolidations: ${programmes.length}`,
    '',
    'Contents',
    '  Courses/<department>/<programme>/<code>.pdf   one report per course',
    '  Courses/_failed/                              courses that could not be computed, with the reason',
    '  Consolidations/00_Institution.pdf             institution-wide, by department and programme',
    '  Consolidations/<department>_<programme>.pdf   one per programme',
    '  Appendix/Procedure_and_Parameters.pdf         the ten steps and the parameters each course applied',
    '',
    'Every figure was produced by the calculation engine from the marks as they stood at generation time;',
    'a locked course reports its immutable snapshot instead.',
    '',
  ].join('\n');
  await writeFile(path.join(work, 'MANIFEST.txt'), manifest);

  // ── 6. Zip it, only now that every part exists ──
  await onProgress(done, total, 'Assembling the archive');
  const zipPath = bundlePath(jobId);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await zipDirectory(work, zipPath);
  const zipStat = await stat(zipPath);

  return {
    zipPath,
    fileName: `Accreditation_Bundle_${safe(institutionName)}_${generatedAt.toISOString().slice(0, 10)}.zip`,
    courseCount: courses.length,
    programmeCount: programmes.length,
    skipped,
    byteLength: zipStat.size,
    generatedAt: generatedAt.toISOString(),
  };
}

function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}

/** How much of a previous run survives — shown before a restart. */
export async function bundleProgressOnDisk(jobId: string): Promise<number> {
  const work = workingDir(jobId);
  let count = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else if (entry.name.endsWith('.pdf')) count += 1;
    }
  };
  await walk(work);
  return count;
}
