import { describe, expect, it } from 'vitest';
import { computeCourse, step5GroupCoLevels } from '../src/index';
import type { Assessment, AssessmentCoResult, CourseInput } from '../src/index';
import { columnMarks, makeCo, makeParams } from './fixtures/helpers';

/** Minimal assessment stub; step5 uses only id → weightGroup. */
function stub(id: string, weightGroup: string): Assessment {
  return {
    id,
    name: id,
    shape: 'ITEM_LIST',
    scoringRule: 'RUBRIC',
    weightGroup,
    items: [{ id: `${id}-i`, maxMark: 1, coTag: null }],
    marks: {},
  };
}

function row(assessmentId: string, coId: string, level: number | null): AssessmentCoResult {
  return { procedureStep: 4, assessmentId, coId, level };
}

const weightGroups = { internal: 0.2, continuous: 0.1, external: 0.7 };

describe('Step 5 — consolidate within each weight group', () => {
  it('a CO assessed in one test carries that value; in two, their mean (the Procedure rule, generalised)', () => {
    // internal: cia1 co1=2, co2=2;  cia2 co2=1.
    const { results } = step5GroupCoLevels(
      weightGroups,
      [stub('cia1', 'internal'), stub('cia2', 'internal')],
      [row('cia1', 'co1', 2), row('cia1', 'co2', 2), row('cia2', 'co2', 1)],
      ['co1', 'co2'],
    );
    expect(results).toEqual([
      expect.objectContaining({ groupId: 'internal', coId: 'co1', level: 2, contributions: [{ assessmentId: 'cia1', level: 2 }] }),
      expect.objectContaining({
        groupId: 'internal',
        coId: 'co2',
        level: 1.5,
        contributions: [
          { assessmentId: 'cia1', level: 2 },
          { assessmentId: 'cia2', level: 1 },
        ],
      }),
    ]);
  });

  it('groups consolidate independently (Steps 6 and 7 fall out of Step 5)', () => {
    const { results } = step5GroupCoLevels(
      weightGroups,
      [stub('assign', 'continuous'), stub('quiz', 'continuous'), stub('endsem', 'external')],
      [row('assign', 'co1', 3), row('quiz', 'co1', 2), row('endsem', 'co1', 2)],
      ['co1'],
    );
    expect(results.find((r) => r.groupId === 'continuous')?.level).toBeCloseTo(2.5, 12);
    expect(results.find((r) => r.groupId === 'external')?.level).toBe(2);
  });

  it('null assessment levels (nothing attempted) are excluded, never averaged as zero', () => {
    const { results } = step5GroupCoLevels(
      weightGroups,
      [stub('a1', 'internal'), stub('a2', 'internal')],
      [row('a1', 'co1', null), row('a2', 'co1', 3)],
      ['co1'],
    );
    expect(results.find((r) => r.coId === 'co1')?.level).toBe(3); // not (0+3)/2
  });

  it('a CO with no value in any group gets CO_NOT_ASSESSED (§5.1)', () => {
    const { results, warnings } = step5GroupCoLevels(
      weightGroups,
      [stub('a1', 'internal')],
      [row('a1', 'co1', 2)],
      ['co1', 'co2'],
    );
    expect(results.some((r) => r.coId === 'co2')).toBe(false);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'CO_NOT_ASSESSED', severity: 'warning', ref: { coId: 'co2' } }),
    ]);
  });
});

describe('Step 5 — nothing assumes exactly two internal tests', () => {
  /** A sectioned internal test with a single 1-mark CO1 question. */
  function sectionedTest(id: string, marks: (number | null)[]): Assessment {
    return {
      id,
      name: id,
      shape: 'SECTIONED',
      scoringRule: 'RUBRIC',
      weightGroup: 'internal',
      sections: [{ id: 'sec1', name: 'Section A', items: [{ id: 'q1', maxMark: 1, coTag: 'co1' }] }],
      marks: columnMarks('q1', marks),
    };
  }

  function courseWith(tests: Assessment[]): CourseInput {
    return {
      cos: [makeCo('co1')],
      poMatrix: { co1: { po1: 3 } },
      parameters: makeParams({ weightGroups: { internal: 1 } }),
      assessments: tests,
      indirect: { co1: { n1: 0, n2: 0, n3: 5 } }, // indirect = 3
    };
  }

  it('five sectioned tests: internal level is the mean of all five', () => {
    // Hand-computed per test (5 students, 1-mark item):
    //  T1 [1,1,1,1,1] → 100% → 3      T2 [1,1,1,1,0] → 80% → 3
    //  T3 [1,1,1,0,0] → 60% → 2       T4 [1,1,0,0,0] → 40% → 1
    //  T5 [1,0,0,0,0] → 20% → 0
    // internal co1 = (3+3+2+1+0)/5 = 1.8
    // final = 0.9 × 1.8 + 0.1 × 3 = 1.62 + 0.3 = 1.92
    const result = computeCourse(
      courseWith([
        sectionedTest('t1', [1, 1, 1, 1, 1]),
        sectionedTest('t2', [1, 1, 1, 1, 0]),
        sectionedTest('t3', [1, 1, 1, 0, 0]),
        sectionedTest('t4', [1, 1, 0, 0, 0]),
        sectionedTest('t5', [1, 0, 0, 0, 0]),
      ]),
    );
    const internal = result.groupCo.find((r) => r.groupId === 'internal' && r.coId === 'co1');
    expect(internal?.level).toBeCloseTo(1.8, 12);
    expect(internal?.contributions).toHaveLength(5);
    expect(result.finalCo[0]?.final).toBeCloseTo(1.92, 12);
  });

  it('one sectioned test: the CO carries that single test’s value', () => {
    // T3 alone: internal = 2. final = 0.9 × 2 + 0.1 × 3 = 2.1.
    const result = computeCourse(courseWith([sectionedTest('t3', [1, 1, 1, 0, 0])]));
    const internal = result.groupCo.find((r) => r.groupId === 'internal' && r.coId === 'co1');
    expect(internal?.level).toBe(2);
    expect(internal?.contributions).toHaveLength(1);
    expect(result.finalCo[0]?.final).toBeCloseTo(2.1, 12);
  });
});
