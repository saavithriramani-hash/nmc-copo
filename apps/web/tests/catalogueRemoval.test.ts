import { describe, expect, it } from 'vitest';
import {
  courseBlockMessage,
  courseBlockers,
  courseDeletionSummary,
  shouldDeleteStudentRecord,
  studentBlockMessage,
  studentBlockingCourses,
  studentRemovalSummary,
} from '../lib/catalogueRemoval';

/**
 * CR-9: deleting a course and removing a student from a roster. Pure — no
 * database.
 *
 * The policy is refuse-and-explain, as for the structural spine: no mark,
 * learner rating, snapshot or review history is ever removed as a side
 * effect. These tests pin that each kind of recorded work is counted on
 * its own, because a missed one would let the examinations office delete
 * someone's marks by deleting the course or student that holds them.
 */

const NONE = { marks: 0, learnerRatings: 0, snapshots: 0, submissions: 0 };
const ALGEBRA = { code: 'MA101', title: 'Algebra' };

describe('course blockers', () => {
  it('permits deletion only when no recorded work exists', () => {
    expect(courseBlockers(NONE)).toEqual([]);
    expect(courseBlockMessage(ALGEBRA, NONE)).toBeNull();
  });

  it('blocks on each kind of recorded work independently', () => {
    for (const key of ['marks', 'learnerRatings', 'snapshots', 'submissions'] as const) {
      expect(courseBlockers({ ...NONE, [key]: 1 }), key).toHaveLength(1);
      expect(courseBlockMessage(ALGEBRA, { ...NONE, [key]: 1 }), key).not.toBeNull();
    }
  });

  it('a single mark entry is enough — including a recorded blank', () => {
    // A blank means "did not attempt", which is a recorded fact distinct
    // from "never entered". Its MarkValue row counts like any other.
    expect(courseBlockers({ ...NONE, marks: 1 })).toEqual([{ label: '1 mark entry', count: 1 }]);
  });

  it('names every blocker at once', () => {
    const message = courseBlockMessage(ALGEBRA, { marks: 1240, learnerRatings: 3, snapshots: 1, submissions: 2 });
    expect(message).toContain('“MA101 — Algebra” cannot be deleted');
    expect(message).toContain('1240 mark entries, 3 learner ratings, 1 locked snapshot and 2 submissions in the review history');
  });

  it('tells the user to clear marks — but not review history, which cannot be cleared', () => {
    expect(courseBlockMessage(ALGEBRA, { ...NONE, marks: 5 })).toMatch(/Clear them first\.$/);
    expect(courseBlockMessage(ALGEBRA, { ...NONE, marks: 5, snapshots: 1 })).toMatch(/accreditation record and stays\.$/);
    expect(courseBlockMessage(ALGEBRA, { ...NONE, submissions: 1 })).toMatch(/accreditation record and stays\.$/);
  });
});

describe('course deletion summary', () => {
  it('discloses what goes with the course before it happens', () => {
    expect(courseDeletionSummary(ALGEBRA, { cos: 5, assessments: 3, enrolments: 60, instructors: 1 })).toBe(
      'Delete course “MA101 — Algebra”, with its 5 COs, 3 assessments, 60 enrolled students and 1 faculty assignment? This cannot be undone.',
    );
  });

  it('says nothing about set-up the course does not have', () => {
    expect(courseDeletionSummary(ALGEBRA, { cos: 0, assessments: 0, enrolments: 0, instructors: 0 })).toBe(
      'Delete course “MA101 — Algebra”? This cannot be undone.',
    );
  });
});

describe('student blockers', () => {
  it('permits removal when not enrolled anywhere', () => {
    expect(studentBlockingCourses([])).toEqual([]);
  });

  it('permits removal when enrolled only on courses where nothing is recorded', () => {
    expect(
      studentBlockingCourses([
        { courseCode: 'MA101', marks: 0, learnerRatings: 0 },
        { courseCode: 'MA102', marks: 0, learnerRatings: 0 },
      ]),
    ).toEqual([]);
  });

  it('blocks on marks and on learner ratings, each on its own', () => {
    expect(studentBlockingCourses([{ courseCode: 'MA101', marks: 1, learnerRatings: 0 }])).toEqual(['MA101']);
    expect(studentBlockingCourses([{ courseCode: 'MA102', marks: 0, learnerRatings: 1 }])).toEqual(['MA102']);
  });

  it('names only the blocking courses, sorted', () => {
    expect(
      studentBlockingCourses([
        { courseCode: 'MA103', marks: 4, learnerRatings: 0 },
        { courseCode: 'MA101', marks: 0, learnerRatings: 0 },
        { courseCode: 'MA102', marks: 2, learnerRatings: 1 },
      ]),
    ).toEqual(['MA102', 'MA103']);
  });

  it('says which courses and what to do', () => {
    expect(studentBlockMessage({ registerNumber: '23MA001', fullName: 'Priya S' }, ['MA102', 'MA103'])).toBe(
      '“23MA001 — Priya S” cannot be removed: they have marks or learner ratings recorded in MA102 and MA103. Those must be cleared on each course first.',
    );
  });
});

describe('student removal summary', () => {
  const PRIYA = { registerNumber: '23MA001', fullName: 'Priya S' };

  it('discloses the enrolments that go with them', () => {
    expect(studentRemovalSummary(PRIYA, 2)).toBe(
      'Remove “23MA001 — Priya S” from this batch and from the 2 courses they are enrolled on? This cannot be undone.',
    );
  });

  it('is plain when they are enrolled nowhere', () => {
    expect(studentRemovalSummary(PRIYA, 0)).toBe('Remove “23MA001 — Priya S” from this batch? This cannot be undone.');
  });
});

describe('the student record itself', () => {
  it('is deleted only when this roster entry was its last', () => {
    expect(shouldDeleteStudentRecord(0)).toBe(true);
    expect(shouldDeleteStudentRecord(1)).toBe(false);
  });
});
