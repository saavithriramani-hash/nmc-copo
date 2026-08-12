/**
 * How ready a course is to be submitted — the pure half of the
 * dashboard, kept apart from the queries so it can be tested directly.
 *
 * "Ready" here is never a judgement about the attainment figures. It is
 * only about whether the inputs the Procedure needs are present: COs, an
 * assessment structure, students, their marks, and the indirect
 * feedback. What those inputs then produce is the engine's business.
 */

export interface CourseReadiness {
  id: string;
  code: string;
  title: string;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED';
  isLaboratory: boolean;
  programmeName: string;
  departmentName: string;
  batchName: string;
  instructors: string[];
  cos: number;
  assessments: number;
  enrolments: number;
  /** Mark cells actually filled, and how many the full grid would hold. */
  marksEntered: number;
  markCells: number;
  hasFeedback: boolean;
  lockedVersion: number | null;
}

/**
 * How far from submittable a course is, as a percentage of its cells.
 *
 * Null — not 0 — when there is no grid yet: a course with no assessments
 * or no students has nothing to be a percentage of, and "0%" would read
 * as a failure to enter marks rather than as a course nobody has set up.
 */
export function markCompletion(course: Pick<CourseReadiness, 'marksEntered' | 'markCells'>): number | null {
  if (course.markCells === 0) return null;
  return Math.round((course.marksEntered / course.markCells) * 100);
}

/**
 * The first thing still missing, in the order the work is actually done.
 * Null when the course is ready to submit. One sentence, because a
 * dashboard row has room for one.
 *
 * Order matters: there is no point telling someone marks are 40% entered
 * when half the class is not enrolled yet.
 */
export function nextStep(course: CourseReadiness): string | null {
  if (course.instructors.length === 0) return 'No faculty assigned';
  if (course.cos === 0) return 'No course outcomes yet';
  if (course.assessments === 0) return 'No assessments yet';
  if (course.enrolments === 0) return 'No students enrolled';
  if (course.markCells > 0 && course.marksEntered === 0) return 'No marks entered';
  if (course.markCells > 0 && course.marksEntered < course.markCells) {
    return `Marks ${markCompletion(course)}% entered`;
  }
  // Not a blocker — §5.1 says a course with no indirect data reports
  // direct-only and flagged, so it may legitimately be submitted this
  // way. It is said last because it is the one item on this list that is
  // a choice rather than an omission.
  if (!course.hasFeedback) return 'No indirect feedback (the course will report direct-only)';
  return null;
}
