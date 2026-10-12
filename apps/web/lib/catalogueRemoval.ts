/**
 * CR-9: removing a course from the catalogue, and a student from a batch
 * roster. Pure, so every rule is unit-testable without a database.
 *
 * The same refuse-and-explain policy as the structural spine
 * (structureAdmin.ts): a removal proceeds only while no RECORDED WORK
 * depends on the row — a mark entry (a blank one included: "did not
 * attempt" is a recorded fact), a learner rating, a locked snapshot or a
 * submission in the review history. If any does, the action refuses and
 * names it. No recorded work is ever removed as a side effect.
 *
 * What a course owns — its COs, assessments, sections and items, CO tags,
 * matrix cells, indirect feedback counts, enrolments and faculty
 * assignments — is set-up, not recorded work, and is removed with it. The
 * precedent is a programme's PO/PSO definitions, which go with the
 * programme. The confirmation states the counts before it happens.
 *
 * A student's enrolments are removed with their roster entry for the same
 * reason; reaching that point already means none of them holds a mark.
 *
 * The database enforces the core of this independently: `onDelete:
 * Restrict` on every relation into Enrolment and Course means a mark or
 * snapshot that slips in between the check and the delete makes the
 * delete fail rather than take it along.
 */

import { joinBlockers, pluralise, type Blocker } from './structureAdmin';

function collect(entries: [number, string, string?][]): Blocker[] {
  const blockers: Blocker[] = [];
  for (const [count, singular, plural] of entries) {
    if (count > 0) blockers.push({ label: pluralise(count, singular, plural), count });
  }
  return blockers;
}

// ── courses ──────────────────────────────────────────────────────────────

export interface CourseRecordedWork {
  marks: number;
  learnerRatings: number;
  snapshots: number;
  submissions: number;
}

export function courseBlockers(counts: CourseRecordedWork): Blocker[] {
  return collect([
    [counts.marks, 'mark entry', 'mark entries'],
    [counts.learnerRatings, 'learner rating'],
    [counts.snapshots, 'locked snapshot'],
    [counts.submissions, 'submission in the review history', 'submissions in the review history'],
  ]);
}

/** "MA101 — Algebra" — how a course is named in every message here. */
export function courseLabel(course: { code: string; title: string }): string {
  return `${course.code} — ${course.title}`;
}

/**
 * Null when nothing blocks. Marks and ratings can be cleared by the
 * course's own chain; review history cannot, so a course that has been
 * through review says so rather than sending someone to look for a
 * "clear" button that does not exist.
 */
export function courseBlockMessage(course: { code: string; title: string }, counts: CourseRecordedWork): string | null {
  const blockers = courseBlockers(counts);
  if (blockers.length === 0) return null;
  const advice =
    counts.snapshots > 0 || counts.submissions > 0
      ? 'A course that has been through review is part of the accreditation record and stays.'
      : 'Clear them first.';
  return `“${courseLabel(course)}” cannot be deleted: it holds ${joinBlockers(blockers)}. ${advice}`;
}

/** What the confirmation must disclose before a course is deleted. */
export function courseDeletionSummary(
  course: { code: string; title: string },
  owned: { cos: number; assessments: number; enrolments: number; instructors: number },
): string {
  const parts = collect([
    [owned.cos, 'CO'],
    [owned.assessments, 'assessment'],
    [owned.enrolments, 'enrolled student'],
    [owned.instructors, 'faculty assignment'],
  ]);
  const withParts = parts.length > 0 ? `, with its ${joinBlockers(parts)}` : '';
  return `Delete course “${courseLabel(course)}”${withParts}? This cannot be undone.`;
}

// ── students ─────────────────────────────────────────────────────────────

/** One course a student is enrolled on, with what they hold there. */
export interface StudentEnrolmentLoad {
  courseCode: string;
  marks: number;
  learnerRatings: number;
}

/**
 * The course codes holding the student's recorded work, sorted and
 * de-duplicated. Empty means the student may be removed.
 */
export function studentBlockingCourses(enrolments: StudentEnrolmentLoad[]): string[] {
  const codes = enrolments.filter((e) => e.marks > 0 || e.learnerRatings > 0).map((e) => e.courseCode);
  return [...new Set(codes)].sort();
}

/** "21MA001 — Priya S" — how a roster entry is named in every message here. */
export function studentLabel(entry: { registerNumber: string; fullName: string }): string {
  return `${entry.registerNumber} — ${entry.fullName}`;
}

export function studentBlockMessage(entry: { registerNumber: string; fullName: string }, courseCodes: string[]): string {
  const courses = joinBlockers(courseCodes.map((code) => ({ label: code, count: 1 })));
  return `“${studentLabel(entry)}” cannot be removed: they have marks or learner ratings recorded in ${courses}. Those must be cleared on each course first.`;
}

/** What the confirmation must disclose before a student is removed. */
export function studentRemovalSummary(entry: { registerNumber: string; fullName: string }, enrolments: number): string {
  const withEnrolments = enrolments > 0 ? ` and from the ${pluralise(enrolments, 'course')} they are enrolled on` : '';
  return `Remove “${studentLabel(entry)}” from this batch${withEnrolments}? This cannot be undone.`;
}

/**
 * The Student row is removed only when this roster entry was its last:
 * a student who also belongs to another batch keeps their record there.
 */
export function shouldDeleteStudentRecord(otherRosterEntries: number): boolean {
  return otherRosterEntries === 0;
}
