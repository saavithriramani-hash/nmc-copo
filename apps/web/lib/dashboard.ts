import 'server-only';
import { prisma } from './db';
import type { CourseReadiness } from './dashboardReadiness';

export type { CourseReadiness } from './dashboardReadiness';
export { markCompletion, nextStep } from './dashboardReadiness';

/**
 * The dashboards' data (FR-16 review rounds, plus readiness).
 *
 * THE RULE THAT SHAPES EVERY QUERY HERE: no attainment. Attainment is
 * computed live from every mark in a course — that is what `computeLive`
 * does, and it is why programme and institution consolidation are
 * background jobs. A dashboard listing thirty courses cannot run the
 * engine thirty times; on the real corpus (~2–3M marks a semester) it
 * would be a consolidation pretending to be a page load.
 *
 * So these are counts and statuses only, from indexed columns. What a
 * dashboard answers is "is this course READY, and does it need me?" —
 * never "what is its attainment?". The one exception costs nothing: a
 * LOCKED course's figures are already computed and stored in its
 * snapshot, so they can be read without touching a mark.
 */

/**
 * Readiness for a set of courses, in one pass.
 *
 * `_count` gives the cheap parts. Mark completeness needs one grouped
 * count over MarkValue — a single indexed aggregate for the whole set,
 * not one query per course, and it never loads a mark's value.
 */
export async function courseReadiness(where: object): Promise<CourseReadiness[]> {
  const courses = await prisma.course.findMany({
    where,
    include: {
      batch: { include: { programme: { include: { department: true } } } },
      instructors: { include: { user: { select: { fullName: true } } } },
      snapshots: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
      assessments: { select: { _count: { select: { items: true } } } },
      _count: { select: { cos: true, assessments: true, enrolments: true } },
    },
    orderBy: [{ batch: { programme: { name: 'asc' } } }, { code: 'asc' }],
  });
  if (courses.length === 0) return [];

  const ids = courses.map((course) => course.id);
  const [entered, feedback] = await Promise.all([
    // Attempted cells only: a blank is a recorded "did not attempt", not
    // progress, and counting it as progress would call a course finished
    // when nobody had marked it.
    prisma.markValue.groupBy({
      by: ['courseId'],
      where: { courseId: { in: ids }, value: { not: null } },
      _count: { _all: true },
    }),
    // Feedback hangs off the CO, not the course, so the count comes
    // through CourseOutcome. A course "has feedback" once any CO does —
    // enough for a readiness hint; the engine decides the rest.
    prisma.courseOutcome.groupBy({
      by: ['courseId'],
      where: { courseId: { in: ids }, indirect: { isNot: null } },
      _count: { _all: true },
    }),
  ]);
  const enteredBy = new Map(entered.map((row) => [row.courseId, row._count._all]));
  const feedbackBy = new Set(feedback.map((row) => row.courseId));

  return courses.map((course) => {
    const items = course.assessments.reduce((sum, a) => sum + a._count.items, 0);
    return {
      id: course.id,
      code: course.code,
      title: course.title,
      status: course.status,
      isLaboratory: course.isLaboratory,
      programmeName: course.batch.programme.name,
      departmentName: course.batch.programme.department.name,
      batchName: course.batch.name,
      instructors: course.instructors.map((i) => i.user.fullName),
      cos: course._count.cos,
      assessments: course._count.assessments,
      enrolments: course._count.enrolments,
      marksEntered: enteredBy.get(course.id) ?? 0,
      markCells: items * course._count.enrolments,
      hasFeedback: feedbackBy.has(course.id),
      lockedVersion: course.snapshots[0]?.version ?? null,
    };
  });
}

export interface ReviewRound {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  departmentName: string;
  submittedAt: Date;
  submittedBy: string;
  resolution: 'PENDING' | 'RETURNED' | 'APPROVED';
  resolvedAt: Date | null;
  resolvedBy: string | null;
  returnComment: string | null;
  approvedVersion: number | null;
}

const toRound = (row: {
  id: string;
  courseId: string;
  submittedAt: Date;
  resolution: 'PENDING' | 'RETURNED' | 'APPROVED';
  resolvedAt: Date | null;
  returnComment: string | null;
  approvedVersion: number | null;
  submittedBy: { fullName: string };
  resolvedBy: { fullName: string } | null;
  course: { code: string; title: string; batch: { programme: { department: { name: string } } } };
}): ReviewRound => ({
  id: row.id,
  courseId: row.courseId,
  courseCode: row.course.code,
  courseTitle: row.course.title,
  departmentName: row.course.batch.programme.department.name,
  submittedAt: row.submittedAt,
  submittedBy: row.submittedBy.fullName,
  resolution: row.resolution,
  resolvedAt: row.resolvedAt,
  resolvedBy: row.resolvedBy?.fullName ?? null,
  returnComment: row.returnComment,
  approvedVersion: row.approvedVersion,
});

const ROUND_INCLUDE = {
  submittedBy: { select: { fullName: true } },
  resolvedBy: { select: { fullName: true } },
  course: { select: { code: true, title: true, batch: { select: { programme: { select: { department: { select: { name: true } } } } } } } },
} as const;

/** Submissions waiting on a decision, oldest first — the HoD's queue. */
export async function pendingRounds(courseIds: string[]): Promise<ReviewRound[]> {
  if (courseIds.length === 0) return [];
  const rows = await prisma.courseSubmission.findMany({
    where: { courseId: { in: courseIds }, resolution: 'PENDING' },
    include: ROUND_INCLUDE,
    orderBy: { submittedAt: 'asc' },
  });
  return rows.map(toRound);
}

/**
 * The latest round per course, whatever became of it.
 *
 * Drives both "what was I asked to change?" for faculty and "what have I
 * sent back that has not come again?" for the HoD — the same row read
 * from either end.
 */
export async function latestRoundPerCourse(courseIds: string[]): Promise<Map<string, ReviewRound>> {
  if (courseIds.length === 0) return new Map();
  const rows = await prisma.courseSubmission.findMany({
    where: { courseId: { in: courseIds } },
    include: ROUND_INCLUDE,
    orderBy: { submittedAt: 'desc' },
  });
  const latest = new Map<string, ReviewRound>();
  for (const row of rows) if (!latest.has(row.courseId)) latest.set(row.courseId, toRound(row));
  return latest;
}

/** Every round for one course, newest first — the review history. */
export async function roundsForCourse(courseId: string): Promise<ReviewRound[]> {
  const rows = await prisma.courseSubmission.findMany({
    where: { courseId },
    include: ROUND_INCLUDE,
    orderBy: { submittedAt: 'desc' },
  });
  return rows.map(toRound);
}

/** Whole-college counts for the read-only rollup. Counts, never marks. */
export async function institutionRollup(): Promise<
  { departmentName: string; draft: number; submitted: number; locked: number }[]
> {
  // groupBy cannot reach through a relation to the department, so the
  // split is done here over a projection carrying only the status and
  // the department name — no marks, no course rows of any weight.
  const byDepartment = await prisma.course.findMany({
    select: { status: true, batch: { select: { programme: { select: { department: { select: { name: true } } } } } } },
  });

  const tally = new Map<string, { departmentName: string; draft: number; submitted: number; locked: number }>();
  for (const course of byDepartment) {
    const name = course.batch.programme.department.name;
    const entry = tally.get(name) ?? { departmentName: name, draft: 0, submitted: 0, locked: 0 };
    if (course.status === 'DRAFT') entry.draft += 1;
    else if (course.status === 'SUBMITTED') entry.submitted += 1;
    else entry.locked += 1;
    tally.set(name, entry);
  }
  return [...tally.values()].sort((a, b) => a.departmentName.localeCompare(b.departmentName));
}
