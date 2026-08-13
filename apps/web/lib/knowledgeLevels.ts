import 'server-only';
import { institutionParameters, parameterOverrides } from '@copo/db';
import { computeKnowledgeLevels, step2ResolveParameters } from '@copo/engine';
import type { KnowledgeItem, KnowledgeLevelResult } from '@copo/engine';
import { BLOOM_LEVELS } from './bloom';
import { prisma } from './db';

/**
 * The learning outcome report (CR-7), from the marks already entered.
 *
 * ONE PAPER AT A TIME, because that is what the college's sheet is: a
 * question paper's blueprint, and a student's marks read against it.
 * Combining several papers would give the share of some notional
 * aggregate that nobody set and nobody sat.
 *
 * Nothing here is stored. The blueprint is derived from the assessment
 * structure and the attainment from the marks, exactly as everything
 * else in this system is (§9, no stored derived values).
 */

export interface TaggedAssessment {
  id: string;
  name: string;
  weightGroup: string;
  taggedItems: number;
  totalItems: number;
}

export interface KnowledgeLevelReport {
  assessment: TaggedAssessment;
  /** Register number and name per enrolment id, for display only. */
  studentById: Record<string, { registerNumber: string; fullName: string }>;
  /**
   * The tagged questions in paper order — exactly the set every figure
   * was computed from, so the blueprint can name what it counted.
   */
  questions: { id: string; label: string; level: string; maxMark: number }[];
  result: KnowledgeLevelResult;
}

/**
 * Every assessment of the course, with how much of it is tagged.
 *
 * Assessments with no tagged question are listed too, and deliberately:
 * the screen has to be able to say "this paper is not tagged yet"
 * rather than leaving a faculty member wondering why their test is
 * missing from a list they cannot see the rule for.
 */
export async function taggedAssessments(courseId: string): Promise<TaggedAssessment[]> {
  const assessments = await prisma.assessment.findMany({
    where: { courseId },
    select: {
      id: true,
      name: true,
      weightGroup: true,
      displayOrder: true,
      items: { select: { bloomLevel: true } },
    },
    orderBy: { displayOrder: 'asc' },
  });

  return assessments.map((a) => ({
    id: a.id,
    name: a.name,
    weightGroup: a.weightGroup,
    taggedItems: a.items.filter((i) => i.bloomLevel !== null).length,
    totalItems: a.items.length,
  }));
}

/**
 * The report for one assessment, or null when the assessment has no
 * tagged question — there is nothing to measure, and an empty report
 * would look like a failure rather than an absence of tagging.
 */
export async function knowledgeLevelReport(
  courseId: string,
  assessmentId: string,
): Promise<KnowledgeLevelReport | null> {
  const assessment = await prisma.assessment.findFirst({
    // courseId in the filter, not just the id: an assessment id from
    // another course must not resolve merely because the caller was
    // allowed to read this one.
    where: { id: assessmentId, courseId },
    select: {
      id: true,
      name: true,
      weightGroup: true,
      items: {
        select: { id: true, label: true, maxMark: true, bloomLevel: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
      course: {
        select: {
          targetAttainment: true,
          thresholdFraction: true,
          bands: true,
          cohortBands: true,
          weightGroups: true,
          directWeight: true,
          indirectWeight: true,
          feedbackResponseFloor: true,
          batch: {
            select: {
              programme: {
                select: {
                  targetAttainment: true,
                  thresholdFraction: true,
                  bands: true,
                  cohortBands: true,
                  weightGroups: true,
                  directWeight: true,
                  indirectWeight: true,
                  feedbackResponseFloor: true,
                  department: { select: { institution: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!assessment) return null;

  const tagged = assessment.items.filter((item) => item.bloomLevel !== null);
  if (tagged.length === 0) return null;

  const programme = assessment.course.batch.programme;
  // The same institution → programme → course resolution the ten steps
  // use, so the band table on this report is the one the course is
  // actually graded against — not a second copy that could drift.
  const { parameters } = step2ResolveParameters(
    institutionParameters(programme.department.institution),
    parameterOverrides(programme),
    parameterOverrides(assessment.course),
  );

  const [enrolments, markRows] = await Promise.all([
    prisma.enrolment.findMany({
      where: { courseId },
      // The register number lives on the batch roster entry, not the
      // student: the same person carries a different number in a
      // different batch.
      select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
      orderBy: { rosterEntry: { registerNumber: 'asc' } },
    }),
    // Only the tagged questions' marks. A paper with three tagged
    // questions does not load the whole course's marks to report on them.
    prisma.markValue.findMany({
      where: { itemId: { in: tagged.map((item) => item.id) } },
      select: { enrolmentId: true, itemId: true, value: true },
    }),
  ]);

  const marks: Record<string, Record<string, number | null>> = {};
  for (const row of markRows) {
    (marks[row.enrolmentId] ??= {})[row.itemId] = row.value === null ? null : Number(row.value);
  }

  const items: KnowledgeItem[] = tagged.map((item) => ({
    id: item.id,
    maxMark: Number(item.maxMark),
    level: item.bloomLevel!,
  }));

  const result = computeKnowledgeLevels({
    // Every level of the taxonomy, not only the ones this paper uses:
    // that a paper examines no analysis at all is the finding the
    // blueprint exists to show.
    levels: [...BLOOM_LEVELS],
    items,
    marks,
    studentIds: enrolments.map((e) => e.id),
    bands: parameters.bands,
  });

  return {
    assessment: {
      id: assessment.id,
      name: assessment.name,
      weightGroup: assessment.weightGroup,
      taggedItems: tagged.length,
      totalItems: assessment.items.length,
    },
    studentById: Object.fromEntries(
      enrolments.map((e) => [
        e.id,
        { registerNumber: e.rosterEntry.registerNumber, fullName: e.rosterEntry.student.fullName },
      ]),
    ),
    questions: tagged.map((item) => ({
      id: item.id,
      label: item.label,
      level: item.bloomLevel!,
      maxMark: Number(item.maxMark),
    })),
    result,
  };
}
