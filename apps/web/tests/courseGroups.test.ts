import { describe, expect, it } from 'vitest';
import { OPEN_GROUPS_UP_TO, groupCourses, startsOpen, type GroupableCourse } from '../lib/courseGroups';

/** Courses grouped by programme, then batch (Courses page and dashboard). */

const course = (over: Partial<GroupableCourse> & { code: string }): GroupableCourse => ({
  semester: 1,
  programmeId: 'p-math',
  programmeName: 'B.Sc. Mathematics',
  departmentName: 'Mathematics',
  batchId: 'b-2024',
  batchName: '2024–2027',
  batchStartYear: 2024,
  ...over,
});

const PHYSICS = { programmeId: 'p-phys', programmeName: 'B.Sc. Physics', departmentName: 'Physics' };
const MATH_2025 = { batchId: 'b-2025', batchName: '2025–2028', batchStartYear: 2025 };
const MATH_2023 = { batchId: 'b-2023', batchName: '2023–2026', batchStartYear: 2023 };

const shape = (groups: ReturnType<typeof groupCourses>) =>
  groups.map((p) => [p.programmeName, p.batches.map((b) => [b.batchName, b.courses.map((c) => c.code)])]);

describe('grouping courses by programme, then batch', () => {
  it('returns nothing for no courses — no empty headings', () => {
    expect(groupCourses([])).toEqual([]);
  });

  it('orders programmes by name, whatever order the courses arrive in', () => {
    const groups = groupCourses([course({ code: 'PH101', ...PHYSICS }), course({ code: 'MA101' })]);
    expect(groups.map((p) => p.programmeName)).toEqual(['B.Sc. Mathematics', 'B.Sc. Physics']);
  });

  it('puts the newest batch first within a programme', () => {
    const groups = groupCourses([
      course({ code: 'MA301', ...MATH_2023 }),
      course({ code: 'MA101', ...MATH_2025 }),
      course({ code: 'MA201' }),
    ]);
    expect(groups[0]!.batches.map((b) => b.batchName)).toEqual(['2025–2028', '2024–2027', '2023–2026']);
  });

  it('orders courses within a batch by semester, then code', () => {
    const groups = groupCourses([
      course({ code: 'MA202', semester: 2 }),
      course({ code: 'MA110', semester: 1 }),
      course({ code: 'MA201', semester: 2 }),
      course({ code: 'MA102', semester: 1 }),
    ]);
    expect(shape(groups)).toEqual([['B.Sc. Mathematics', [['2024–2027', ['MA102', 'MA110', 'MA201', 'MA202']]]]]);
  });

  it('compares codes as people read them: MA9 before MA10', () => {
    const groups = groupCourses([course({ code: 'MA10' }), course({ code: 'MA9' })]);
    expect(groups[0]!.batches[0]!.courses.map((c) => c.code)).toEqual(['MA9', 'MA10']);
  });

  it('keeps two programmes of the same name apart — grouping is by id, not by name', () => {
    const groups = groupCourses([
      course({ code: 'MA101' }),
      course({ code: 'MA101', programmeId: 'p-math-other', batchId: 'b-other' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((p) => p.programmeId)).toEqual(['p-math', 'p-math-other']);
  });

  it('breaks a tie between batches of the same start year by name', () => {
    const groups = groupCourses([
      course({ code: 'MA101', batchId: 'b-a', batchName: '2024–2027 A' }),
      course({ code: 'MA101', batchId: 'b-b', batchName: '2024–2027 B' }),
    ]);
    // Newest-first applies to the name too, so the order is stable and reversed with it.
    expect(groups[0]!.batches.map((b) => b.batchName)).toEqual(['2024–2027 B', '2024–2027 A']);
  });

  it('counts the courses of each programme across all its batches', () => {
    const groups = groupCourses([
      course({ code: 'MA101' }),
      course({ code: 'MA102' }),
      course({ code: 'MA101', ...MATH_2025 }),
      course({ code: 'PH101', ...PHYSICS }),
    ]);
    expect(groups.map((p) => [p.programmeName, p.courseCount])).toEqual([
      ['B.Sc. Mathematics', 3],
      ['B.Sc. Physics', 1],
    ]);
  });

  it('a programme with one batch has one batch group', () => {
    const groups = groupCourses([course({ code: 'PH101', ...PHYSICS }), course({ code: 'PH102', ...PHYSICS })]);
    expect(shape(groups)).toEqual([['B.Sc. Physics', [['2024–2027', ['PH101', 'PH102']]]]]);
  });

  it('carries each course through whole, extra fields included', () => {
    const groups = groupCourses([{ ...course({ code: 'MA101' }), id: 'c-1', status: 'DRAFT' }]);
    expect(groups[0]!.batches[0]!.courses[0]).toMatchObject({ id: 'c-1', status: 'DRAFT', code: 'MA101' });
  });

  it('does not reorder the caller’s array', () => {
    const input = [course({ code: 'MA102' }), course({ code: 'MA101' })];
    groupCourses(input);
    expect(input.map((c) => c.code)).toEqual(['MA102', 'MA101']);
  });
});

describe('which lists start open', () => {
  it('opens a short list and folds a long one, at exactly the boundary', () => {
    expect(startsOpen(0)).toBe(true);
    expect(startsOpen(OPEN_GROUPS_UP_TO)).toBe(true);
    expect(startsOpen(OPEN_GROUPS_UP_TO + 1)).toBe(false);
  });
});
