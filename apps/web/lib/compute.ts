import 'server-only';
import { loadCourseInput } from '@copo/db';
import { computeCourse } from '@copo/engine';
import type { CourseInput, CourseResult, Step2Result } from '@copo/engine';
import { prisma } from './db';

/**
 * The application's single entry point to the engine.
 *
 * On demand and fast: one course's own marks are loaded through the
 * assessment index and handed to the pure engine — nothing is stored, so
 * every figure always reflects the marks as they stand (§9 "no stored
 * derived values"). The ONE exception is a locked course, whose official
 * numbers come from its immutable snapshot rather than a recomputation:
 * the snapshot is the record of what was approved.
 */

export interface Refs {
  coCodeById: Record<string, string>;
  poCodeById: Record<string, string>;
  /** Display names for drill-down: assessments, sections, items, students. */
  assessmentNameById: Record<string, string>;
  sectionNameById: Record<string, string>;
  itemLabelById: Record<string, string>;
  studentByEnrolmentId: Record<string, { registerNumber: string; fullName: string }>;
}

export interface CourseAttainment {
  /** 'live' = computed now from marks; 'snapshot' = the locked record. */
  source: 'live' | 'snapshot';
  version: number | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  input: CourseInput;
  result: CourseResult;
  refs: Refs;
  parameterResolution: Step2Result | null;
}

/** Display maps for the drill-down, keyed by the engine's opaque ids. */
export async function loadRefs(courseId: string, base: { coCodeById: Record<string, string>; poCodeById: Record<string, string> }): Promise<Refs> {
  const [assessments, enrolments] = await Promise.all([
    prisma.assessment.findMany({
      where: { courseId },
      select: {
        id: true,
        name: true,
        sections: { select: { id: true, name: true } },
        items: { select: { id: true, label: true } },
      },
    }),
    prisma.enrolment.findMany({
      where: { courseId },
      select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
    }),
  ]);

  const assessmentNameById: Record<string, string> = {};
  const sectionNameById: Record<string, string> = {};
  const itemLabelById: Record<string, string> = {};
  for (const assessment of assessments) {
    assessmentNameById[assessment.id] = assessment.name;
    // A SINGLE_SCORE assessment is one pseudo-item keyed by the assessment id.
    itemLabelById[assessment.id] = assessment.name;
    for (const section of assessment.sections) sectionNameById[section.id] = section.name;
    for (const item of assessment.items) itemLabelById[item.id] = item.label;
  }

  const studentByEnrolmentId: Record<string, { registerNumber: string; fullName: string }> = {};
  for (const enrolment of enrolments) {
    studentByEnrolmentId[enrolment.id] = {
      registerNumber: enrolment.rosterEntry.registerNumber,
      fullName: enrolment.rosterEntry.student.fullName,
    };
  }

  return { ...base, assessmentNameById, sectionNameById, itemLabelById, studentByEnrolmentId };
}

/** Computes a course from its current marks. Pure engine, no writes. */
export async function computeLive(courseId: string): Promise<CourseAttainment> {
  const loaded = await loadCourseInput(prisma, courseId);
  const result = computeCourse(loaded.input);
  return {
    source: 'live',
    version: null,
    lockedAt: null,
    lockedBy: null,
    input: loaded.input,
    result,
    refs: await loadRefs(courseId, loaded.refs),
    parameterResolution: loaded.parameterResolution,
  };
}

/**
 * The attainment a user should see: the immutable snapshot for a LOCKED
 * course, otherwise a live computation.
 */
export async function getCourseAttainment(courseId: string): Promise<CourseAttainment> {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { status: true } });
  if (course.status !== 'LOCKED') return computeLive(courseId);

  const snapshot = await prisma.attainmentSnapshot.findFirst({
    where: { courseId },
    orderBy: { version: 'desc' },
    include: { createdBy: { select: { fullName: true } } },
  });
  if (!snapshot) return computeLive(courseId); // locked without a snapshot should not happen

  const stored = snapshot.result as unknown as { result: CourseResult; refs: Refs };
  return {
    source: 'snapshot',
    version: snapshot.version,
    lockedAt: snapshot.createdAt,
    lockedBy: snapshot.createdBy.fullName,
    input: snapshot.input as unknown as CourseInput,
    result: stored.result,
    refs: stored.refs,
    parameterResolution: null,
  };
}
