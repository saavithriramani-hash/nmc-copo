import 'server-only';
import {
  computeLearnerCategories,
  type LearnerCategoryResult,
  type LearnerCourseRatings,
  type LearnerCriterion,
} from '@copo/engine';
import { prisma } from './db';
import { resolveCategoryBands, type AppliedBands } from './learnerBands';

export { resolveCategoryBands, type AppliedBands };

/**
 * Slow and advanced learners (CR-8, NAAC 2.2.1) — the college's
 * identification, from the ratings faculty enter and the marks already
 * in the ledger.
 *
 * Nothing here is stored. The weightage is derived from marks and the
 * category from the score, exactly as everything else in this system is
 * (§9, no stored derived values). What IS stored is only the four
 * judgements a teacher cannot compute.
 *
 * SCALE. The weightage needs every mark of every subject a cohort took,
 * which at full size is millions of rows — so it is never loaded. Both
 * the numerator and the denominator come back as database aggregates
 * (`groupBy … _sum`), one row per student and one per assessment.
 */

export interface CriterionRow {
  id: string;
  label: string;
  maxScore: number;
  derived: boolean;
  displayOrder: number;
}

export interface StudentRef {
  registerNumber: string;
  fullName: string;
}

// ── criteria and bands ────────────────────────────────────────────────────

export async function learnerCriteria(programmeId: string): Promise<CriterionRow[]> {
  const rows = await prisma.learnerCriterion.findMany({
    where: { programmeId },
    orderBy: { displayOrder: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    maxScore: Number(r.maxScore),
    derived: r.derived,
    displayOrder: r.displayOrder,
  }));
}

// ── the derived weightage ─────────────────────────────────────────────────

export interface DerivedWeightage {
  /** enrolmentId → score on the criterion scale, or null. */
  byEnrolment: Record<string, number | null>;
  /** Courses that carry no marks at all, so no weightage exists for them. */
  coursesWithoutMarks: string[];
  /** Enrolments whose marks exceed the paper total — a mark-entry fault. */
  overMaximum: string[];
}

/**
 * The workbook's "Weightage (20) CIA & semester": the student's total
 * marks as a share of the marks their subjects allotted, on the
 * criterion's scale.
 *
 * Every value in the filed sheet's column H is a multiple of 0.2 on a
 * 20-point criterion — that is, an integer percentage scaled by 20 —
 * which is what fixed the definition. Retyped by hand there; counted here.
 *
 * THE DENOMINATOR IS WHAT THE PAPERS ALLOTTED, not what the student
 * attempted, matching the learning-outcome report and for the same
 * reason: a question left blank is not evidence of ability. A student who
 * attempted nothing at all in a subject has no weightage for it rather
 * than a zero.
 */
export async function derivedWeightage(courseIds: string[], maxScore: number): Promise<DerivedWeightage> {
  const byEnrolment: Record<string, number | null> = {};
  const coursesWithoutMarks: string[] = [];
  const overMaximum: string[] = [];
  if (courseIds.length === 0) return { byEnrolment, coursesWithoutMarks, overMaximum };

  const assessments = await prisma.assessment.findMany({
    where: { courseId: { in: courseIds } },
    select: { id: true, courseId: true },
  });

  // Aggregated in the database: the marks themselves never come back.
  const [itemTotals, markSums, enrolments] = await Promise.all([
    assessments.length > 0
      ? prisma.item.groupBy({
          by: ['assessmentId'],
          where: { assessmentId: { in: assessments.map((a) => a.id) } },
          _sum: { maxMark: true },
        })
      : Promise.resolve([] as { assessmentId: string; _sum: { maxMark: unknown } }[]),
    prisma.markValue.groupBy({
      by: ['enrolmentId', 'courseId'],
      where: { courseId: { in: courseIds } },
      _sum: { value: true },
      // Counts NON-NULL values, which is exactly "attempted something".
      _count: { value: true },
    }),
    prisma.enrolment.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true },
    }),
  ]);

  const maxByAssessment = new Map(itemTotals.map((row) => [row.assessmentId, Number(row._sum.maxMark ?? 0)]));
  const maxByCourse = new Map<string, number>();
  for (const courseId of courseIds) maxByCourse.set(courseId, 0);
  for (const a of assessments) {
    maxByCourse.set(a.courseId, (maxByCourse.get(a.courseId) ?? 0) + (maxByAssessment.get(a.id) ?? 0));
  }
  for (const [courseId, total] of maxByCourse) if (total <= 0) coursesWithoutMarks.push(courseId);

  const sums = new Map(markSums.map((row) => [row.enrolmentId, row]));

  for (const enrolment of enrolments) {
    const total = maxByCourse.get(enrolment.courseId) ?? 0;
    const row = sums.get(enrolment.id);
    // No mark row, or every one of them blank: the student sat nothing
    // here. Null, never zero — a zero would say they sat it and failed.
    if (total <= 0 || !row || row._count.value === 0) {
      byEnrolment[enrolment.id] = null;
      continue;
    }
    const awarded = Number(row._sum.value ?? 0);
    const scaled = (awarded / total) * maxScore;
    if (scaled > maxScore) {
      // Marks above the paper total. A data fault, not a rating: named
      // and left out rather than clamped into looking correct.
      overMaximum.push(enrolment.id);
      byEnrolment[enrolment.id] = null;
      continue;
    }
    byEnrolment[enrolment.id] = scaled;
  }

  return { byEnrolment, coursesWithoutMarks, overMaximum };
}

// ── one course's rating sheet ─────────────────────────────────────────────

export interface CourseRatingSheet {
  course: { id: string; code: string; title: string; semester: number; programmeId: string; batchId: string };
  criteria: CriterionRow[];
  students: { enrolmentId: string; registerNumber: string; fullName: string }[];
  /** enrolmentId → criterionId → score. Absent = not rated. */
  scores: Record<string, Record<string, number | null>>;
  /** enrolmentId → the derived weightage, for the read-only column. */
  weightage: Record<string, number | null>;
  /** Raw marks behind the weightage, so the figure can be checked. */
  marksTotal: number;
}

export async function courseRatingSheet(courseId: string): Promise<CourseRatingSheet | null> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      code: true,
      title: true,
      semester: true,
      batch: { select: { id: true, programmeId: true } },
    },
  });
  if (!course) return null;

  const programmeId = course.batch.programmeId;
  const criteria = await learnerCriteria(programmeId);

  const [enrolments, ratings] = await Promise.all([
    prisma.enrolment.findMany({
      where: { courseId },
      select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
      orderBy: { rosterEntry: { registerNumber: 'asc' } },
    }),
    prisma.learnerRating.findMany({
      where: { enrolment: { courseId } },
      select: { enrolmentId: true, criterionId: true, score: true },
    }),
  ]);

  // A row IS a judgement — `score` is NOT NULL — so an unrated cell is
  // simply a key that is not here, which is what the grid renders blank
  // and what the engine reads as "not rated".
  const scores: Record<string, Record<string, number | null>> = {};
  for (const r of ratings) {
    (scores[r.enrolmentId] ??= {})[r.criterionId] = Number(r.score);
  }

  const derivedCriterion = criteria.find((c) => c.derived);
  const derived = derivedCriterion
    ? await derivedWeightage([courseId], derivedCriterion.maxScore)
    : { byEnrolment: {}, coursesWithoutMarks: [], overMaximum: [] };

  const itemTotal = await prisma.item.aggregate({
    where: { assessment: { courseId } },
    _sum: { maxMark: true },
  });

  return {
    course: { ...course, programmeId, batchId: course.batch.id },
    criteria,
    students: enrolments.map((e) => ({
      enrolmentId: e.id,
      registerNumber: e.rosterEntry.registerNumber,
      fullName: e.rosterEntry.student.fullName,
    })),
    scores,
    weightage: derived.byEnrolment,
    marksTotal: Number(itemTotal._sum.maxMark ?? 0),
  };
}

// ── the semester consolidation ────────────────────────────────────────────

export interface LearnerCategoryReport {
  programme: { id: string; name: string; departmentId: string; departmentName: string };
  batch: { id: string; name: string };
  semester: number;
  criteria: CriterionRow[];
  courses: { id: string; code: string; title: string }[];
  studentById: Record<string, StudentRef>;
  /**
   * courseId → studentId → criterionId → score, exactly as the engine was
   * fed — derived criterion merged in, students absent when not enrolled.
   * Carried so the workbook writes the very cells the figures came from
   * rather than re-deriving them from a second query that could differ.
   */
  courseScores: Record<string, Record<string, Record<string, number | null>>>;
  /** The roll in report order, so a sheet's rows line up with `result.students`. */
  roster: { studentId: string; registerNumber: string; fullName: string }[];
  applied: AppliedBands;
  result: LearnerCategoryResult;
}

/** The batches and semesters this report can be run for. */
export async function learnerReportOptions(
  programmeId: string,
): Promise<{ batch: { id: string; name: string }; semesters: number[] }[]> {
  const batches = await prisma.batch.findMany({
    where: { programmeId },
    select: { id: true, name: true, courses: { select: { semester: true } } },
    orderBy: { startYear: 'desc' },
  });
  return batches.map((b) => ({
    batch: { id: b.id, name: b.name },
    semesters: [...new Set(b.courses.map((c) => c.semester))].sort((x, y) => x - y),
  }));
}

/**
 * One batch, one semester: every subject it took, consolidated.
 *
 * The student is keyed by their ROSTER ENTRY, not by their enrolment,
 * because the whole point is to gather one person across several
 * subjects. The engine is handed enrolment-free ids for that reason.
 */
export async function learnerCategoryReport(
  programmeId: string,
  batchId: string,
  semester: number,
): Promise<LearnerCategoryReport | null> {
  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: {
      id: true,
      name: true,
      departmentId: true,
      learnerBands: true,
      department: { select: { name: true, institution: { select: { learnerBands: true } } } },
    },
  });
  if (!programme) return null;

  const batch = await prisma.batch.findFirst({
    // programmeId in the filter: a batch id from another programme must
    // not resolve merely because the caller may read this one.
    where: { id: batchId, programmeId },
    select: { id: true, name: true },
  });
  if (!batch) return null;

  const [criteria, courses, roster] = await Promise.all([
    learnerCriteria(programmeId),
    prisma.course.findMany({
      where: { batchId, semester },
      select: { id: true, code: true, title: true },
      orderBy: { code: 'asc' },
    }),
    prisma.batchRoster.findMany({
      where: { batchId },
      select: { id: true, registerNumber: true, student: { select: { fullName: true } } },
      orderBy: { registerNumber: 'asc' },
    }),
  ]);

  const courseIds = courses.map((c) => c.id);
  const derivedCriterion = criteria.find((c) => c.derived);

  const [enrolments, ratings, derived] = await Promise.all([
    prisma.enrolment.findMany({
      where: { courseId: { in: courseIds } },
      select: { id: true, courseId: true, rosterEntryId: true },
    }),
    prisma.learnerRating.findMany({
      where: { enrolment: { courseId: { in: courseIds } } },
      select: { enrolmentId: true, criterionId: true, score: true },
    }),
    derivedCriterion
      ? derivedWeightage(courseIds, derivedCriterion.maxScore)
      : Promise.resolve<DerivedWeightage>({ byEnrolment: {}, coursesWithoutMarks: [], overMaximum: [] }),
  ]);

  const maxByCriterion = new Map(criteria.map((c) => [c.id, c.maxScore]));
  const ratingByEnrolment = new Map<string, Record<string, number | null>>();
  // A rating above its criterion's maximum makes the engine throw, by
  // design — it is a contract violation, not a figure. The write path
  // refuses to create one, but a maximum lowered before that check
  // existed, or a hand-edited row, must not take the whole report down.
  // Excluded and named, exactly as CR-7 handles a question tagged outside
  // its taxonomy.
  const outOfRange: string[] = [];
  for (const r of ratings) {
    const score = Number(r.score);
    const max = maxByCriterion.get(r.criterionId);
    if (max !== undefined && score > max) {
      outOfRange.push(r.criterionId);
      continue;
    }
    const row = ratingByEnrolment.get(r.enrolmentId) ?? {};
    row[r.criterionId] = score;
    ratingByEnrolment.set(r.enrolmentId, row);
  }

  const courseRatings: LearnerCourseRatings[] = courses.map((course) => {
    const mine = enrolments.filter((e) => e.courseId === course.id);
    const scores: Record<string, Record<string, number | null>> = {};
    for (const e of mine) {
      const row = { ...(ratingByEnrolment.get(e.id) ?? {}) };
      // The derived criterion is never stored, so it is merged in here
      // rather than read: one place computes it, for the sheet and for
      // the consolidation alike.
      if (derivedCriterion) row[derivedCriterion.id] = derived.byEnrolment[e.id] ?? null;
      scores[e.rosterEntryId] = row;
    }
    return {
      courseId: course.id,
      courseTitle: `${course.code} ${course.title}`,
      studentIds: mine.map((e) => e.rosterEntryId),
      scores,
    };
  });

  const engineCriteria: LearnerCriterion[] = criteria.map((c) => ({
    id: c.id,
    label: c.label,
    maxScore: c.maxScore,
    derived: c.derived,
  }));

  const applied = resolveCategoryBands(programme.learnerBands, programme.department.institution.learnerBands);

  const result = computeLearnerCategories({
    criteria: engineCriteria,
    courses: courseRatings,
    studentIds: roster.map((r) => r.id),
    bands: applied.bands,
  });

  if (outOfRange.length > 0) {
    const names = [...new Set(outOfRange)]
      .map((id) => criteria.find((c) => c.id === id)?.label ?? id)
      .join(', ');
    result.warnings.push({
      code: 'LC_PARTIALLY_RATED',
      severity: 'warning',
      message: `${outOfRange.length} rating(s) exceed the maximum now set for their criterion (${names}) and are excluded. This happens when a criterion's maximum is lowered after ratings were entered against it; correct those ratings, or raise the maximum back.`,
      ref: {},
    });
  }

  // Marks that exceed the paper total are a fault in the ledger, not a
  // property of the cohort, so the engine cannot know about them.
  if (derived.overMaximum.length > 0) {
    result.warnings.push({
      code: 'LC_NO_MARKS',
      severity: 'warning',
      message: `${derived.overMaximum.length} enrolment(s) carry marks above the total their papers allot, so no weightage could be derived for them. Check the mark entry for those subjects.`,
      ref: {},
    });
  }
  for (const courseId of derived.coursesWithoutMarks) {
    const course = courses.find((c) => c.id === courseId);
    result.warnings.push({
      code: 'LC_NO_MARKS',
      severity: 'info',
      message: `'${course?.code ?? courseId}' has no assessments carrying marks, so it contributes no weightage.`,
      ref: { courseId },
    });
  }

  return {
    programme: {
      id: programme.id,
      name: programme.name,
      departmentId: programme.departmentId,
      departmentName: programme.department.name,
    },
    batch,
    semester,
    criteria,
    courses,
    studentById: Object.fromEntries(
      roster.map((r) => [r.id, { registerNumber: r.registerNumber, fullName: r.student.fullName }]),
    ),
    courseScores: Object.fromEntries(courseRatings.map((c) => [c.courseId, c.scores])),
    roster: roster.map((r) => ({
      studentId: r.id,
      registerNumber: r.registerNumber,
      fullName: r.student.fullName,
    })),
    applied,
    result,
  };
}
