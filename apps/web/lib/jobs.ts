import 'server-only';
import type { Prisma } from '@copo/db';
import { prisma } from './db';
import { computeLive } from './compute';
import { meanAcrossCourses, type CoursePoRow, type PoMeanCell } from './consolidate';

/**
 * Background jobs (NFR-2, NFR-4). Programme and institution
 * consolidations run here with a progress indicator, never as a blocking
 * request: the action creates a PENDING row, returns its id immediately,
 * and a detached async runner updates progress as it goes. The page polls
 * the row.
 *
 * DB-backed and in-process — no queue service for the IT staff to run
 * (NFR-5). Restartable by design: a job stores only its own result and
 * derives everything else from marks, so a job killed mid-run is simply
 * started again.
 */

export type JobKind = 'PROGRAMME_CONSOLIDATION' | 'INSTITUTION_CONSOLIDATION';

export interface ConsolidationResult {
  scopeLabel: string;
  poCodes: string[];
  courses: CoursePoRow[];
  means: Record<string, PoMeanCell>;
  /** Grouping label per course (programme name) for the institution view. */
  groupOf?: Record<string, string>;
  generatedAt: string;
}

export async function createJob(kind: JobKind, payload: Prisma.InputJsonValue, userId: string): Promise<string> {
  const job = await prisma.job.create({ data: { kind, payload, createdById: userId, status: 'PENDING' } });
  // Detached: the request returns immediately; `next start` keeps running.
  void runJob(job.id).catch(async (err) => {
    await prisma.job
      .update({
        where: { id: job.id },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
      })
      .catch(() => undefined);
  });
  return job.id;
}

async function setProgress(jobId: string, progress: number, note: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { progress, progressNote: note } });
}

async function runJob(jobId: string): Promise<void> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== 'PENDING') return;
  await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date(), progress: 0 } });

  const payload = job.payload as { programmeId?: string };
  const result =
    job.kind === 'PROGRAMME_CONSOLIDATION'
      ? await consolidateProgramme(jobId, payload.programmeId!)
      : await consolidateInstitution(jobId);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      progress: 100,
      progressNote: 'Done',
      result: result as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
}

/**
 * Computes every course of a set, one at a time, reporting progress. A
 * course that cannot be computed records its error and the run continues
 * — one broken course must not sink a whole consolidation.
 */
async function consolidateCourses(
  jobId: string,
  courseIds: { id: string; code: string; title: string; semester: number }[],
  poCodes: string[],
): Promise<CoursePoRow[]> {
  const rows: CoursePoRow[] = [];
  for (const [index, course] of courseIds.entries()) {
    await setProgress(jobId, Math.round((index / Math.max(courseIds.length, 1)) * 100), `Computing ${course.code} (${index + 1} of ${courseIds.length})`);
    try {
      const attainment = await computeLive(course.id);
      const po: Record<string, number | null> = {};
      for (const entry of attainment.result.po) {
        const code = attainment.refs.poCodeById[entry.poId] ?? entry.poId;
        po[code] = entry.official;
      }
      rows.push({
        courseId: course.id,
        code: course.code,
        title: course.title,
        semester: course.semester,
        po,
        warningCount: attainment.result.warnings.length,
      });
    } catch (err) {
      rows.push({
        courseId: course.id,
        code: course.code,
        title: course.title,
        semester: course.semester,
        po: Object.fromEntries(poCodes.map((code) => [code, null])),
        warningCount: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return rows;
}

async function consolidateProgramme(jobId: string, programmeId: string): Promise<ConsolidationResult> {
  const programme = await prisma.programme.findUniqueOrThrow({
    where: { id: programmeId },
    select: {
      name: true,
      outcomes: { orderBy: { displayOrder: 'asc' }, select: { code: true } },
      batches: { select: { courses: { select: { id: true, code: true, title: true, semester: true } } } },
    },
  });
  const poCodes = programme.outcomes.map((po) => po.code);
  const courses = programme.batches.flatMap((batch) => batch.courses).sort((a, b) => a.code.localeCompare(b.code));
  const rows = await consolidateCourses(jobId, courses, poCodes);
  return {
    scopeLabel: programme.name,
    poCodes,
    courses: rows,
    means: meanAcrossCourses(rows, poCodes),
    generatedAt: new Date().toISOString(),
  };
}

async function consolidateInstitution(jobId: string): Promise<ConsolidationResult> {
  const programmes = await prisma.programme.findMany({
    select: {
      id: true,
      name: true,
      department: { select: { name: true } },
      outcomes: { orderBy: { displayOrder: 'asc' }, select: { code: true } },
      batches: { select: { courses: { select: { id: true, code: true, title: true, semester: true } } } },
    },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
  });

  // PO codes differ per programme; the institution view uses the union so
  // every column is present, and a course simply has no value where its
  // programme does not define that PO.
  const poCodes = [...new Set(programmes.flatMap((p) => p.outcomes.map((po) => po.code)))].sort();
  const groupOf: Record<string, string> = {};
  const courses: { id: string; code: string; title: string; semester: number }[] = [];
  for (const programme of programmes) {
    for (const batch of programme.batches) {
      for (const course of batch.courses) {
        courses.push(course);
        groupOf[course.id] = `${programme.department.name} · ${programme.name}`;
      }
    }
  }
  const rows = await consolidateCourses(jobId, courses, poCodes);
  return {
    scopeLabel: 'Institution',
    poCodes,
    courses: rows,
    means: meanAcrossCourses(rows, poCodes),
    groupOf,
    generatedAt: new Date().toISOString(),
  };
}
