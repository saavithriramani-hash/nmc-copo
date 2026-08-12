import { describe, expect, it } from 'vitest';
import { markCompletion, nextStep } from '../lib/dashboardReadiness';
import type { CourseReadiness } from '../lib/dashboardReadiness';

/** A course with everything present, which each test then takes away from. */
const ready = (over: Partial<CourseReadiness> = {}): CourseReadiness => ({
  id: 'c1',
  code: 'MAT101',
  title: 'Algebra',
  status: 'DRAFT',
  isLaboratory: false,
  programmeName: 'B.Sc. Mathematics',
  departmentName: 'Mathematics',
  batchName: '2024-2027',
  instructors: ['R. Kalaiselvi'],
  cos: 5,
  assessments: 4,
  enrolments: 40,
  marksEntered: 400,
  markCells: 400,
  hasFeedback: true,
  lockedVersion: null,
  ...over,
});

describe('markCompletion', () => {
  it('is a rounded percentage of the grid', () => {
    expect(markCompletion({ marksEntered: 200, markCells: 400 })).toBe(50);
    expect(markCompletion({ marksEntered: 1, markCells: 3 })).toBe(33);
    expect(markCompletion({ marksEntered: 2, markCells: 3 })).toBe(67);
  });

  it('is 100 only when the grid is full', () => {
    expect(markCompletion({ marksEntered: 400, markCells: 400 })).toBe(100);
    expect(markCompletion({ marksEntered: 399, markCells: 400 })).toBe(100);
  });

  it('is null, not zero, when there is no grid to fill', () => {
    // A course with no assessments or no students. Reporting 0% would
    // read as "nobody entered the marks" instead of "there is nothing to
    // enter marks into yet".
    expect(markCompletion({ marksEntered: 0, markCells: 0 })).toBeNull();
  });
});

describe('nextStep', () => {
  it('is null when nothing is missing', () => {
    expect(nextStep(ready())).toBeNull();
  });

  it('asks for the things a course needs in the order they are done', () => {
    expect(nextStep(ready({ instructors: [], cos: 0, assessments: 0, enrolments: 0 }))).toBe('No faculty assigned');
    expect(nextStep(ready({ cos: 0, assessments: 0, enrolments: 0 }))).toBe('No course outcomes yet');
    expect(nextStep(ready({ assessments: 0, enrolments: 0 }))).toBe('No assessments yet');
    expect(nextStep(ready({ enrolments: 0 }))).toBe('No students enrolled');
  });

  it('separates an empty grid from a partly filled one', () => {
    expect(nextStep(ready({ marksEntered: 0 }))).toBe('No marks entered');
    expect(nextStep(ready({ marksEntered: 100 }))).toBe('Marks 25% entered');
  });

  it('mentions missing feedback last, and says what it costs', () => {
    // §5.1: a course with no indirect data is direct-only and flagged —
    // legitimate, so this is a note rather than a blocker, and it must
    // never displace a genuinely missing input.
    expect(nextStep(ready({ hasFeedback: false }))).toBe('No indirect feedback (the course will report direct-only)');
    expect(nextStep(ready({ hasFeedback: false, marksEntered: 100 }))).toBe('Marks 25% entered');
  });

  it('does not call a course ready because its grid is empty', () => {
    // The guard is markCells > 0, so a course with assessments but no
    // items yet reports the missing structure rather than reading as
    // complete. 0 of 0 cells is not "all marks in".
    expect(nextStep(ready({ marksEntered: 0, markCells: 0, hasFeedback: false }))).toBe(
      'No indirect feedback (the course will report direct-only)',
    );
    expect(nextStep(ready({ marksEntered: 0, markCells: 0 }))).toBeNull();
  });
});
