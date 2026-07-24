import { describe, expect, it } from 'vitest';
import { step3ScoreItems } from '../src/index';
import type { Assessment } from '../src/index';
import { columnMarks, makeParams, repeat } from './fixtures/helpers';

const params = makeParams();

/** One-item ITEM_LIST assessment around a single mark column. */
function oneItem(maxMark: number, coTag: string | null, values: (number | null)[]): Assessment {
  return {
    id: 'a',
    name: 'Assessment A',
    shape: 'ITEM_LIST',
    scoringRule: 'RUBRIC',
    weightGroup: 'continuous',
    items: [{ id: 'i1', maxMark, coTag }],
    marks: columnMarks('i1', values),
  };
}

function scoreOne(assessment: Assessment, coIds = ['co1']) {
  const { itemScores, warnings } = step3ScoreItems(assessment, coIds, params);
  expect(itemScores).toHaveLength(1);
  return { score: itemScores[0]!, warnings };
}

describe('Step 3 — threshold: attained ⟺ mark ≥ 0.70 × maximum (§4.1)', () => {
  it('a mark exactly on the threshold counts as attained', () => {
    // 3.5 of 5 is exactly 70%: cleared. 1/1 attempted+cleared → 100% → 3.
    const { score } = scoreOne(oneItem(5, 'co1', [3.5]));
    expect(score.attempted).toBe(1);
    expect(score.cleared).toBe(1);
    expect(score.pct).toBeCloseTo(100, 12);
    expect(score.level).toBe(3);
  });

  it('a mark just below the threshold does not clear', () => {
    // 3.49 of 5 = 69.8%: not cleared → 0/1 → 0% → level 0.
    const { score } = scoreOne(oneItem(5, 'co1', [3.49]));
    expect(score.cleared).toBe(0);
    expect(score.pct).toBeCloseTo(0, 12);
    expect(score.level).toBe(0);
  });

  it('10-mark item: exactly 7 clears', () => {
    const { score } = scoreOne(oneItem(10, 'co1', [7]));
    expect(score.cleared).toBe(1);
  });

  it('2-mark item: exactly 1.4 clears', () => {
    const { score } = scoreOne(oneItem(2, 'co1', [1.4]));
    expect(score.cleared).toBe(1);
  });

  it('1-mark item under the uniform rule: a full mark clears, a half mark does not (§4.1)', () => {
    // Threshold 0.7 × 1 = 0.7. Marks [1, 0.5, 0, null]:
    // attempted 3 (null excluded), cleared 1 (only the full mark) → 33.33% → 0.
    const { score } = scoreOne(oneItem(1, 'co1', [1, 0.5, 0, null]));
    expect(score.attempted).toBe(3);
    expect(score.cleared).toBe(1);
    expect(score.pct).toBeCloseTo(100 / 3, 12);
    expect(score.level).toBe(0);
  });
});

describe('Step 3 — band boundaries (§4.2): ≥80→3, ≥60→2, ≥40→1, else 0', () => {
  // Five students on a 1-mark item; a 1 clears (≥0.7), a 0 does not.
  const cases: Array<{ marks: number[]; pct: number; level: number }> = [
    { marks: [1, 1, 1, 1, 1], pct: 100, level: 3 },
    { marks: [1, 1, 1, 1, 0], pct: 80, level: 3 }, // exactly 80 → 3
    { marks: [1, 1, 1, 0, 0], pct: 60, level: 2 }, // exactly 60 → 2
    { marks: [1, 1, 0, 0, 0], pct: 40, level: 1 }, // exactly 40 → 1
    { marks: [1, 0, 0, 0, 0], pct: 20, level: 0 },
  ];

  for (const { marks, pct, level } of cases) {
    it(`${pct}% of students clearing → level ${level}`, () => {
      const { score } = scoreOne(oneItem(1, 'co1', marks));
      expect(score.pct).toBeCloseTo(pct, 12);
      expect(score.level).toBe(level);
      expect(Number.isInteger(score.level)).toBe(true); // levels are integers, never strings
      expect(score.matchedBand).toEqual(params.bands.find((b) => b.level === level));
    });
  }

  it('just below each boundary lands on the band beneath (1000-student cohorts)', () => {
    // 799/1000 = 79.9% → 2;  599/1000 = 59.9% → 1;  399/1000 = 39.9% → 0.
    const below: Array<{ cleared: number; pct: number; level: number }> = [
      { cleared: 799, pct: 79.9, level: 2 },
      { cleared: 599, pct: 59.9, level: 1 },
      { cleared: 399, pct: 39.9, level: 0 },
    ];
    for (const { cleared, pct, level } of below) {
      const values = [...repeat(1, cleared), ...repeat(0, 1000 - cleared)];
      const { score } = scoreOne(oneItem(1, 'co1', values));
      expect(score.attempted).toBe(1000);
      expect(score.cleared).toBe(cleared);
      expect(score.pct).toBeCloseTo(pct, 9);
      expect(score.level).toBe(level);
    }
  });
});

describe('Step 3 — blank is not zero', () => {
  it('null is excluded from the denominator; changing it to 0 changes both denominator and level', () => {
    // [5, 4, 3.5, null]: attempted 3, cleared 3 → 100% → 3.
    const blank = scoreOne(oneItem(5, 'co1', [5, 4, 3.5, null])).score;
    expect(blank.attempted).toBe(3);
    expect(blank.pct).toBeCloseTo(100, 12);
    expect(blank.level).toBe(3);

    // Same marks with the blank turned into a real 0: attempted 4,
    // cleared 3 → 75% → 2. Denominator AND level both change.
    const zero = scoreOne(oneItem(5, 'co1', [5, 4, 3.5, 0])).score;
    expect(zero.attempted).toBe(4);
    expect(zero.pct).toBeCloseTo(75, 12);
    expect(zero.level).toBe(2);
  });

  it('a student row missing the item key is treated as blank', () => {
    const assessment = oneItem(5, 'co1', [5, 4]);
    assessment.marks['S3'] = {}; // enrolled, no mark recorded for i1
    const { score } = scoreOne(assessment);
    expect(score.attempted).toBe(2);
  });
});

describe('Step 3 — degenerate: an item nobody attempted (§5.1)', () => {
  it('yields null pct/level and a structured ITEM_NO_ATTEMPTS warning — not zero, not a crash', () => {
    const { score, warnings } = scoreOne(oneItem(5, 'co1', [null, null, null]));
    expect(score.attempted).toBe(0);
    expect(score.cleared).toBe(0);
    expect(score.pct).toBeNull();
    expect(score.level).toBeNull();
    expect(score.matchedBand).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: 'ITEM_NO_ATTEMPTS',
      severity: 'warning',
      ref: { assessmentId: 'a', itemId: 'i1' },
    });
  });
});

describe('Step 3 — CO applicability', () => {
  it('a tagged item applies only to its CO; an untagged item applies to every CO (§3.1)', () => {
    const tagged = scoreOne(oneItem(5, 'co2', [5]), ['co1', 'co2', 'co3']).score;
    expect(tagged.appliesToCoIds).toEqual(['co2']);

    const untagged = scoreOne(oneItem(5, null, [5]), ['co1', 'co2', 'co3']).score;
    expect(untagged.appliesToCoIds).toEqual(['co1', 'co2', 'co3']);
  });

  it('records section membership for drill-down', () => {
    const sectioned: Assessment = {
      id: 'cia',
      name: 'CIA',
      shape: 'SECTIONED',
      scoringRule: 'RUBRIC',
      weightGroup: 'internal',
      sections: [
        { id: 'sA', name: 'Section A', items: [{ id: 'q1', maxMark: 2, coTag: 'co1' }] },
        { id: 'sB', name: 'Section B', items: [{ id: 'q2', maxMark: 5, coTag: 'co1' }] },
      ],
      marks: { S1: { q1: 2, q2: 5 } },
    };
    const { itemScores } = step3ScoreItems(sectioned, ['co1'], params);
    expect(itemScores.map((s) => ({ itemId: s.itemId, sectionId: s.sectionId }))).toEqual([
      { itemId: 'q1', sectionId: 'sA' },
      { itemId: 'q2', sectionId: 'sB' },
    ]);
  });
});
