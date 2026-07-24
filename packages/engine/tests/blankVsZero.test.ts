import { describe, expect, it } from 'vitest';
import { computeCourse } from '../src/index';
import type { CourseInput } from '../src/index';
import { makeCo, makeParams } from './fixtures/helpers';

/**
 * The blank ≠ zero invariant, end to end: the same course computed twice,
 * with exactly one student's mark changed from null (did not attempt) to 0
 * (attempted, scored nothing). The denominator, the item level and the
 * final CO attainment must all change.
 *
 * Hand derivation (item i1, max 5, threshold 3.5; indirect co1 = 3):
 *  blank: marks [5, 4, 3.5, null] → attempted 3, cleared 3 → 100% → 3
 *         direct = 1.0 × 3 = 3;  final = 0.9(3) + 0.1(3) = 3
 *  zero:  marks [5, 4, 3.5, 0]   → attempted 4, cleared 3 → 75%  → 2
 *         direct = 2;            final = 0.9(2) + 0.1(3) = 2.1
 */
function course(s4Mark: number | null): CourseInput {
  return {
    cos: [makeCo('co1')],
    poMatrix: { co1: { po1: 3 } },
    parameters: makeParams({ weightGroups: { continuous: 1 } }),
    assessments: [
      {
        id: 'a1',
        name: 'Assignment',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        items: [{ id: 'i1', maxMark: 5, coTag: 'co1' }],
        marks: {
          S1: { i1: 5 },
          S2: { i1: 4 },
          S3: { i1: 3.5 },
          S4: { i1: s4Mark },
        },
      },
    ],
    indirect: { co1: { n1: 0, n2: 0, n3: 10 } },
  };
}

describe('blank vs zero — one student flipped from null to 0', () => {
  const blank = computeCourse(course(null));
  const zero = computeCourse(course(0));

  it('blank is excluded from the denominator; zero is included', () => {
    expect(blank.itemScores[0]?.attempted).toBe(3);
    expect(zero.itemScores[0]?.attempted).toBe(4);
    // cleared unchanged — the flipped student clears the threshold in neither case
    expect(blank.itemScores[0]?.cleared).toBe(3);
    expect(zero.itemScores[0]?.cleared).toBe(3);
  });

  it('the percentage and the item level both change', () => {
    expect(blank.itemScores[0]?.pct).toBeCloseTo(100, 12);
    expect(zero.itemScores[0]?.pct).toBeCloseTo(75, 12);
    expect(blank.itemScores[0]?.level).toBe(3);
    expect(zero.itemScores[0]?.level).toBe(2);
  });

  it('the change propagates to the final CO attainment', () => {
    expect(blank.finalCo[0]?.final).toBeCloseTo(3, 12);
    expect(zero.finalCo[0]?.final).toBeCloseTo(2.1, 12);
  });
});
