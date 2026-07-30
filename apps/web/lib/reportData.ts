import 'server-only';
import { ENGINE_VERSION } from '@copo/engine';
import type { CourseReportData, CourseRow, ConsolidationReportData } from '@copo/report';
import { prisma } from './db';
import { computeLive, getCourseAttainment } from './compute';

/**
 * Assembles the data the printed reports need, from the database plus a
 * live engine computation. Nothing derived is stored: a report always
 * reflects the marks as they stand, except for a locked course, whose
 * figures come from its immutable snapshot (see lib/compute).
 */

export async function loadCourseReportData(courseId: string): Promise<CourseReportData> {
  const [course, source] = await Promise.all([
    prisma.course.findUniqueOrThrow({
      where: { id: courseId },
      select: {
        code: true,
        title: true,
        semester: true,
        credits: true,
        status: true,
        cos: { orderBy: { displayOrder: 'asc' }, select: { id: true, code: true, statement: true, bloomLevels: true } },
        instructors: { select: { user: { select: { fullName: true } } } },
        _count: { select: { enrolments: true } },
        batch: {
          select: {
            name: true,
            programme: {
              select: {
                name: true,
                department: { select: { name: true } },
                outcomes: { orderBy: { displayOrder: 'asc' }, select: { id: true, code: true, kind: true, statement: true } },
              },
            },
          },
        },
      },
    }),
    // A locked course reports its immutable snapshot; anything else is
    // computed live — the same rule the attainment screen follows.
    getCourseAttainment(courseId),
  ]);

  return {
    course: {
      code: course.code,
      title: course.title,
      semester: course.semester,
      credits: course.credits?.toString() ?? null,
      departmentName: course.batch.programme.department.name,
      programmeName: course.batch.programme.name,
      batchName: course.batch.name,
      status: course.status,
      facultyNames: course.instructors.map((instructor) => instructor.user.fullName),
      enrolmentCount: course._count.enrolments,
      snapshotVersion: source.source === 'snapshot' ? source.version : null,
      lockedAt: source.source === 'snapshot' ? source.lockedAt : null,
      lockedBy: source.source === 'snapshot' ? source.lockedBy : null,
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date(),
    },
    cos: course.cos.map((co) => ({ id: co.id, code: co.code, statement: co.statement, bloomLevels: co.bloomLevels })),
    pos: course.batch.programme.outcomes.map((po) => ({
      id: po.id,
      code: po.code,
      kind: po.kind,
      statement: po.statement,
    })),
    input: source.input,
    result: source.result,
    refs: source.refs,
    provenance: source.parameterResolution?.provenance ?? null,
  };
}

export interface ConsolidationCourse {
  id: string;
  code: string;
  title: string;
  semester: number;
  batchName: string;
  programmeName: string;
  departmentName: string;
}

/**
 * Computes each course in turn and collects its official PO figures.
 * Shared by the on-screen consolidation job and the printed reports, so
 * both show identical numbers. One broken course records its error and
 * the run continues — a single bad course must not sink a consolidation.
 */
export async function computeCourseRows(
  courses: ConsolidationCourse[],
  onProgress?: (done: number, total: number, label: string) => Promise<void> | void,
): Promise<CourseRow[]> {
  const rows: CourseRow[] = [];
  for (const [index, course] of courses.entries()) {
    await onProgress?.(index, courses.length, `${course.code} (${index + 1} of ${courses.length})`);
    const base = {
      courseId: course.id,
      code: course.code,
      title: course.title,
      semester: course.semester,
      batchName: course.batchName,
      programmeName: course.programmeName,
      departmentName: course.departmentName,
    };
    try {
      const attainment = await computeLive(course.id);
      const po: Record<string, number | null> = {};
      for (const entry of attainment.result.po) {
        po[attainment.refs.poCodeById[entry.poId] ?? entry.poId] = entry.official;
      }
      rows.push({ ...base, po, warningCount: attainment.result.warnings.length });
    } catch (err) {
      rows.push({ ...base, po: {}, warningCount: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return rows;
}

/** Every course of a programme, flattened across its batches. */
export async function programmeCourses(programmeId: string): Promise<ConsolidationCourse[]> {
  const programme = await prisma.programme.findUniqueOrThrow({
    where: { id: programmeId },
    select: {
      name: true,
      department: { select: { name: true } },
      batches: { select: { name: true, courses: { select: { id: true, code: true, title: true, semester: true } } } },
    },
  });
  return programme.batches
    .flatMap((batch) =>
      batch.courses.map((course) => ({
        ...course,
        batchName: batch.name,
        programmeName: programme.name,
        departmentName: programme.department.name,
      })),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Every course in the institution. */
export async function institutionCourses(): Promise<ConsolidationCourse[]> {
  const programmes = await prisma.programme.findMany({
    select: {
      name: true,
      department: { select: { name: true } },
      batches: { select: { name: true, courses: { select: { id: true, code: true, title: true, semester: true } } } },
    },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
  });
  return programmes.flatMap((programme) =>
    programme.batches.flatMap((batch) =>
      batch.courses.map((course) => ({
        ...course,
        batchName: batch.name,
        programmeName: programme.name,
        departmentName: programme.department.name,
      })),
    ),
  );
}

export async function programmePoCodes(programmeId: string): Promise<{ code: string; statement: string }[]> {
  const outcomes = await prisma.programmeOutcome.findMany({
    where: { programmeId },
    orderBy: { displayOrder: 'asc' },
    select: { code: true, statement: true },
  });
  return outcomes;
}

export async function institutionPoCodes(): Promise<{ code: string; statement: string }[]> {
  const outcomes = await prisma.programmeOutcome.findMany({
    orderBy: { code: 'asc' },
    select: { code: true, statement: true },
  });
  const seen = new Map<string, string>();
  for (const outcome of outcomes) if (!seen.has(outcome.code)) seen.set(outcome.code, outcome.statement);
  return [...seen.entries()].map(([code, statement]) => ({ code, statement })).sort((a, b) => a.code.localeCompare(b.code));
}

/** Mean PO attainment per batch, oldest first — the trend chart's series. */
export async function programmeTrend(programmeId: string): Promise<{ batchName: string; meanPo: number | null }[]> {
  const batches = await prisma.batch.findMany({
    where: { programmeId },
    orderBy: { startYear: 'asc' },
    select: { name: true, courses: { select: { id: true, code: true, title: true, semester: true } } },
  });

  const trend: { batchName: string; meanPo: number | null }[] = [];
  for (const batch of batches) {
    const values: number[] = [];
    for (const course of batch.courses) {
      try {
        const attainment = await computeLive(course.id);
        for (const entry of attainment.result.po) if (entry.official !== null) values.push(entry.official);
      } catch {
        // A course that cannot be computed contributes nothing; the batch
        // still reports the mean of those that could.
      }
    }
    trend.push({
      batchName: batch.name,
      meanPo: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    });
  }
  return trend;
}

export async function buildProgrammeConsolidation(
  programmeId: string,
  filter: { semester?: number; batchName?: string },
): Promise<ConsolidationReportData> {
  const programme = await prisma.programme.findUniqueOrThrow({
    where: { id: programmeId },
    select: { name: true, department: { select: { name: true } }, targetAttainment: true },
  });
  const [courses, poStatements, trend] = await Promise.all([
    programmeCourses(programmeId),
    programmePoCodes(programmeId),
    programmeTrend(programmeId),
  ]);
  const rows = await computeCourseRows(courses);

  return {
    meta: {
      scopeLabel: programme.name,
      scopeContext: programme.department.name,
      filter,
      generatedAt: new Date(),
      engineVersion: ENGINE_VERSION,
    },
    poCodes: poStatements.map((entry) => entry.code),
    poStatements,
    rows,
    trend,
    target: programme.targetAttainment ? programme.targetAttainment.toNumber() : null,
  };
}

export async function buildInstitutionConsolidation(
  filter: { semester?: number; batchName?: string },
): Promise<ConsolidationReportData> {
  const institution = await prisma.institution.findFirst({ select: { name: true, targetAttainment: true } });
  const [courses, poStatements] = await Promise.all([institutionCourses(), institutionPoCodes()]);
  const rows = await computeCourseRows(courses);

  return {
    meta: {
      scopeLabel: institution?.name ?? 'Institution',
      scopeContext: 'All departments',
      filter,
      generatedAt: new Date(),
      engineVersion: ENGINE_VERSION,
    },
    poCodes: poStatements.map((entry) => entry.code),
    poStatements,
    rows,
    target: institution?.targetAttainment ? institution.targetAttainment.toNumber() : null,
  };
}
