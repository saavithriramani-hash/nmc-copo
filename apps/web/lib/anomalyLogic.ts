/**
 * Pure classifiers behind the pre-calculation anomaly report (FR-13).
 * The counting is done in SQL (lib/anomalies.ts, NFR-1); these functions
 * turn those aggregates into findings and are unit-tested on their own.
 */

/** Per-assessment CO coverage, derived from its items/tags. */
export interface AssessmentCoverage {
  assessmentId: string;
  name: string;
  /** True when the assessment applies to EVERY CO (an untagged item, or a
   *  SINGLE_SCORE with no CO tags) — how assignments and the end-semester
   *  paper behave (§3.1). */
  coversAllCos: boolean;
  /** COs explicitly tagged (item coIds / single-score coTags). */
  taggedCoIds: string[];
}

/**
 * COs assessed nowhere. If any assessment covers all COs, none is
 * unassessed; otherwise a CO is unassessed unless some assessment tags it.
 */
export function unassessedCoIds(allCoIds: string[], assessments: AssessmentCoverage[]): string[] {
  if (assessments.some((assessment) => assessment.coversAllCos)) return [];
  const covered = new Set<string>();
  for (const assessment of assessments) for (const coId of assessment.taggedCoIds) covered.add(coId);
  return allCoIds.filter((coId) => !covered.has(coId));
}

/** A section's optional-question rule and one student's attempt count in it. */
export interface SectionAttempt {
  enrolmentId: string;
  registerNumber: string;
  studentName: string;
  sectionId: string;
  sectionName: string;
  assessmentName: string;
  /** Non-null marks the student recorded among the section's items. */
  attempted: number;
  /** The "answer any n of m" permitted count. */
  permitted: number;
}

/** Students who attempted more of a section's optional questions than permitted. */
export function overAttemptedSections(attempts: SectionAttempt[]): SectionAttempt[] {
  return attempts.filter((attempt) => attempt.attempted > attempt.permitted);
}

/** Indirect feedback counts for one CO, and whether the floor is met. */
export interface FeedbackStatus {
  coId: string;
  coCode: string;
  responses: number;
  floor: number;
}

/**
 * COs whose feedback is below the configured floor. A floor of 0 disables
 * the check. "No feedback at all" (0 responses) is reported whenever a
 * floor is set, since 0 < floor.
 */
export function feedbackBelowFloor(statuses: FeedbackStatus[]): FeedbackStatus[] {
  return statuses.filter((status) => status.floor > 0 && status.responses < status.floor);
}
