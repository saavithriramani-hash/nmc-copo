import { describe, expect, it } from 'vitest';
import { analyseGaps } from '../src/gap';
import { applyFilter, groupByDepartment, meanByPo, semestersPresent, type CourseRow } from '../src/grouping';

describe('analyseGaps (§4.5)', () => {
  const cos = [
    { code: 'CO1', statement: 'one', final: 2.115 },
    { code: 'CO2', statement: 'two', final: 2.6 },
    { code: 'CO3', statement: 'three', final: 1.4 },
    { code: 'CO4', statement: 'four', final: null },
  ];

  it('splits met from below target, worst shortfall first', () => {
    const analysis = analyseGaps(cos, 2.5);
    expect(analysis.below.map((row) => row.code)).toEqual(['CO3', 'CO1']); // gaps 1.1 then 0.385
    expect(analysis.below[0]!.gap).toBeCloseTo(1.1, 9);
    expect(analysis.below[1]!.gap).toBeCloseTo(0.385, 9);
    expect(analysis.met.map((row) => row.code)).toEqual(['CO2']);
  });

  it('reports an unmeasured CO separately — not as "below target"', () => {
    const analysis = analyseGaps(cos, 2.5);
    expect(analysis.unmeasured.map((row) => row.code)).toEqual(['CO4']);
    expect(analysis.below.some((row) => row.code === 'CO4')).toBe(false);
    expect(analysis.met.some((row) => row.code === 'CO4')).toBe(false);
  });

  it('a CO exactly on the target has met it', () => {
    const analysis = analyseGaps([{ code: 'CO1', statement: '', final: 2.5 }], 2.5);
    expect(analysis.met).toHaveLength(1);
    expect(analysis.below).toHaveLength(0);
  });

  it('the mean excludes unmeasured COs rather than counting them as zero', () => {
    // (2.115 + 2.6 + 1.4) / 3 = 2.0383…, not / 4.
    const analysis = analyseGaps(cos, 2.5);
    expect(analysis.meanAchieved).toBeCloseTo((2.115 + 2.6 + 1.4) / 3, 9);
  });

  it('all-unmeasured gives a null mean, never 0', () => {
    const analysis = analyseGaps([{ code: 'CO1', statement: '', final: null }], 2.5);
    expect(analysis.meanAchieved).toBeNull();
  });
});

describe('consolidation grouping', () => {
  const row = (over: Partial<CourseRow> & { courseId: string }): CourseRow => ({
    code: over.courseId.toUpperCase(),
    title: 'T',
    semester: 1,
    batchName: '2024–2027',
    programmeName: 'B.Sc. Mathematics',
    departmentName: 'Mathematics',
    po: {},
    warningCount: 0,
    ...over,
  });

  it('meanByPo excludes nulls and reports how many contributed', () => {
    const rows = [row({ courseId: 'a', po: { PO1: 2 } }), row({ courseId: 'b', po: { PO1: null } }), row({ courseId: 'c', po: { PO1: 3 } })];
    expect(meanByPo(rows, ['PO1'])['PO1']).toEqual({ mean: 2.5, n: 2 });
  });

  it('meanByPo returns null, never 0, when nothing contributed', () => {
    expect(meanByPo([row({ courseId: 'a', po: { PO1: null } })], ['PO1'])['PO1']).toEqual({ mean: null, n: 0 });
  });

  it('applyFilter narrows to a semester or a batch', () => {
    const rows = [
      row({ courseId: 'a', semester: 1, batchName: '2023–2026' }),
      row({ courseId: 'b', semester: 3, batchName: '2024–2027' }),
      row({ courseId: 'c', semester: 3, batchName: '2023–2026' }),
    ];
    expect(applyFilter(rows, { semester: 3 }).map((r) => r.courseId)).toEqual(['b', 'c']);
    expect(applyFilter(rows, { batchName: '2023–2026' }).map((r) => r.courseId)).toEqual(['a', 'c']);
    expect(applyFilter(rows, { semester: 3, batchName: '2023–2026' }).map((r) => r.courseId)).toEqual(['c']);
    expect(applyFilter(rows, {})).toHaveLength(3);
  });

  it('groupByDepartment nests programmes under departments, both sorted, with means at each level', () => {
    const rows = [
      row({ courseId: 'p1', departmentName: 'Physics', programmeName: 'B.Sc. Physics', po: { PO1: 2 } }),
      row({ courseId: 'm2', departmentName: 'Mathematics', programmeName: 'M.Sc. Mathematics', po: { PO1: 3 } }),
      row({ courseId: 'm1', departmentName: 'Mathematics', programmeName: 'B.Sc. Mathematics', po: { PO1: 1 } }),
    ];
    const groups = groupByDepartment(rows, ['PO1']);
    expect(groups.map((g) => g.departmentName)).toEqual(['Mathematics', 'Physics']);
    expect(groups[0]!.programmes.map((p) => p.programmeName)).toEqual(['B.Sc. Mathematics', 'M.Sc. Mathematics']);
    // Department mean spans its programmes: (1 + 3) / 2 = 2.
    expect(groups[0]!.means['PO1']).toEqual({ mean: 2, n: 2 });
    expect(groups[1]!.means['PO1']).toEqual({ mean: 2, n: 1 });
  });

  it('semestersPresent lists distinct semesters ascending', () => {
    const rows = [row({ courseId: 'a', semester: 3 }), row({ courseId: 'b', semester: 1 }), row({ courseId: 'c', semester: 3 })];
    expect(semestersPresent(rows)).toEqual([1, 3]);
  });
});
