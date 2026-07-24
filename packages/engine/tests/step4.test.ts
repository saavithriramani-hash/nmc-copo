import { describe, expect, it } from 'vitest';
import { step4AssessmentCoLevels } from '../src/index';
import type { Assessment } from '../src/index';
import { columnMarks, makeParams } from './fixtures/helpers';

const params = makeParams();

describe('Step 4 — SECTIONED: section means, then mean across the sections in which the CO appears', () => {
  // cia2 from the e2e derivation:
  //  secA: q1(max2,co2) [2,2,1,1,1]  → att5 clr2 → 40% → 1
  //        q2(max2,co3) [2,2,2,1,ø]  → att4 clr3 → 75% → 2
  //  secB: q3(max10,co3)[10,9,8,7,6] → att5 clr4 → 80% → 3
  // co2 appears in secA only → 1 (NOT averaged over sections it is absent from)
  // co3: mean(secA 2, secB 3) = 2.5
  const cia2: Assessment = {
    id: 'cia2',
    name: 'Internal Test II',
    shape: 'SECTIONED',
    scoringRule: 'RUBRIC',
    weightGroup: 'internal',
    sections: [
      {
        id: 'secA',
        name: 'Section A',
        items: [
          { id: 'q1', maxMark: 2, coTag: 'co2' },
          { id: 'q2', maxMark: 2, coTag: 'co3' },
        ],
      },
      { id: 'secB', name: 'Section B', items: [{ id: 'q3', maxMark: 10, coTag: 'co3' }] },
    ],
    marks: {
      S1: { q1: 2, q2: 2, q3: 10 },
      S2: { q1: 2, q2: 2, q3: 9 },
      S3: { q1: 1, q2: 2, q3: 8 },
      S4: { q1: 1, q2: 1, q3: 7 },
      S5: { q1: 1, q2: null, q3: 6 },
    },
  };

  it('averages only over the sections in which the CO appears', () => {
    const { results } = step4AssessmentCoLevels(cia2, ['co1', 'co2', 'co3'], params);

    const co2 = results.find((r) => r.coId === 'co2');
    expect(co2?.level).toBeCloseTo(1, 12); // secA only — no phantom secB average
    expect(co2?.sections?.map((s) => s.sectionId)).toEqual(['secA']);

    const co3 = results.find((r) => r.coId === 'co3');
    expect(co3?.level).toBeCloseTo(2.5, 12); // mean(2, 3)
    expect(co3?.sections).toEqual([
      { sectionId: 'secA', itemLevels: [{ itemId: 'q2', level: 2 }], level: 2 },
      { sectionId: 'secB', itemLevels: [{ itemId: 'q3', level: 3 }], level: 3 },
    ]);

    // co1 appears nowhere in this assessment: no row at all.
    expect(results.find((r) => r.coId === 'co1')).toBeUndefined();
  });

  it('an untagged item joins every CO within its section (§3.1)', () => {
    // One section: q1 tagged co1 → level 3 (4/5 = 80%); q2 untagged → level 1 (2/5 = 40%).
    // co1: mean(3, 1) = 2.  co2: q2 only → 1.
    const mixed: Assessment = {
      id: 'mix',
      name: 'Mixed tagging',
      shape: 'SECTIONED',
      scoringRule: 'RUBRIC',
      weightGroup: 'internal',
      sections: [
        {
          id: 's1',
          name: 'Section A',
          items: [
            { id: 'q1', maxMark: 1, coTag: 'co1' },
            { id: 'q2', maxMark: 1, coTag: null },
          ],
        },
      ],
      marks: {
        S1: { q1: 1, q2: 1 },
        S2: { q1: 1, q2: 1 },
        S3: { q1: 1, q2: 0 },
        S4: { q1: 1, q2: 0 },
        S5: { q1: 0, q2: 0 },
      },
    };
    const { results } = step4AssessmentCoLevels(mixed, ['co1', 'co2'], params);
    expect(results.find((r) => r.coId === 'co1')?.level).toBeCloseTo(2, 12);
    expect(results.find((r) => r.coId === 'co2')?.level).toBeCloseTo(1, 12);
  });

  it('a section whose only relevant item was never attempted is excluded from the mean, with the warning raised', () => {
    // secA: q1(co1) all blank → level null (warned). secB: q2(co1) 2/5 = 40% → 1.
    // co1 = mean over sections with a value = 1.
    const withEmpty: Assessment = {
      id: 'we',
      name: 'With empty section',
      shape: 'SECTIONED',
      scoringRule: 'RUBRIC',
      weightGroup: 'internal',
      sections: [
        { id: 'secA', name: 'A', items: [{ id: 'q1', maxMark: 5, coTag: 'co1' }] },
        { id: 'secB', name: 'B', items: [{ id: 'q2', maxMark: 1, coTag: 'co1' }] },
      ],
      marks: {
        S1: { q1: null, q2: 1 },
        S2: { q1: null, q2: 1 },
        S3: { q1: null, q2: 0 },
        S4: { q1: null, q2: 0 },
        S5: { q1: null, q2: 0 },
      },
    };
    const { results, warnings } = step4AssessmentCoLevels(withEmpty, ['co1'], params);
    const co1 = results.find((r) => r.coId === 'co1');
    expect(co1?.level).toBeCloseTo(1, 12);
    expect(co1?.sections).toEqual([
      { sectionId: 'secA', itemLevels: [{ itemId: 'q1', level: null }], level: null },
      { sectionId: 'secB', itemLevels: [{ itemId: 'q2', level: 1 }], level: 1 },
    ]);
    expect(warnings.some((w) => w.code === 'ITEM_NO_ATTEMPTS' && w.ref.itemId === 'q1')).toBe(true);
  });
});

describe('Step 4 — ITEM_LIST: mean of the item levels tagged to the CO, no section layer', () => {
  it('quiz from the e2e derivation: co1 → 2 (z1), co2 → 3 (z2)', () => {
    const quiz: Assessment = {
      id: 'quiz',
      name: 'Quiz',
      shape: 'ITEM_LIST',
      scoringRule: 'RUBRIC',
      weightGroup: 'continuous',
      items: [
        { id: 'z1', maxMark: 1, coTag: 'co1' }, // [1,1,1,0,ø] → att4 clr3 → 75% → 2
        { id: 'z2', maxMark: 1, coTag: 'co2' }, // [1,1,ø,ø,ø] → att2 clr2 → 100% → 3
      ],
      marks: {
        S1: { z1: 1, z2: 1 },
        S2: { z1: 1, z2: 1 },
        S3: { z1: 1, z2: null },
        S4: { z1: 0, z2: null },
        S5: { z1: null, z2: null },
      },
    };
    const { results } = step4AssessmentCoLevels(quiz, ['co1', 'co2', 'co3'], params);
    expect(results).toEqual([
      expect.objectContaining({ coId: 'co1', level: 2, items: [{ itemId: 'z1', level: 2 }] }),
      expect.objectContaining({ coId: 'co2', level: 3, items: [{ itemId: 'z2', level: 3 }] }),
    ]);
  });
});

describe('Step 4 — SINGLE_SCORE + RUBRIC: the score is one item', () => {
  const seminar = (coTags?: string[]): Assessment => ({
    id: 'sem',
    name: 'Seminar',
    shape: 'SINGLE_SCORE',
    scoringRule: 'RUBRIC',
    weightGroup: 'continuous',
    maxMark: 10,
    ...(coTags ? { coTags } : {}),
    // [9,8,7,7,5]: threshold 7 → att5 clr4 (two exactly on 7) → 80% → 3
    marks: columnMarks('sem', [9, 8, 7, 7, 5]),
  });

  it('applies its level to each tagged CO only', () => {
    const { results } = step4AssessmentCoLevels(seminar(['co3']), ['co1', 'co2', 'co3'], params);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ coId: 'co3', level: 3, items: [{ itemId: 'sem', level: 3 }] });
  });

  it('untagged → applies to every CO, with an info ASSESSMENT_UNTAGGED warning (§5.1)', () => {
    const { results, warnings } = step4AssessmentCoLevels(seminar(), ['co1', 'co2', 'co3'], params);
    expect(results.map((r) => r.coId)).toEqual(['co1', 'co2', 'co3']);
    expect(results.every((r) => r.level === 3)).toBe(true);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'ASSESSMENT_UNTAGGED', severity: 'info', ref: { assessmentId: 'sem' } }),
    );
  });
});

describe('Step 4 — SINGLE_SCORE + COHORT_BAND (§4.3, Procedure Step 7)', () => {
  const endsem = (values: (number | null)[]): Assessment => ({
    id: 'es',
    name: 'End-Semester',
    shape: 'SINGLE_SCORE',
    scoringRule: 'COHORT_BAND',
    weightGroup: 'external',
    maxMark: 75,
    coTags: ['co1'],
    marks: columnMarks('es', values),
  });

  function levelOf(values: (number | null)[]) {
    const { results } = step4AssessmentCoLevels(endsem(values), ['co1'], makeParams());
    return results[0]!;
  }

  it('level 3 when ≥50% of attempting students reach 60% of the maximum; a score exactly on the cut-off counts', () => {
    // [75, 60, 45, 30, ø]: attempted 4 (null excluded from the cohort).
    // ≥45 (60% of 75): 75, 60, 45 → 3/4 = 75% ≥ 50 → level 3.
    const r = levelOf([75, 60, 45, 30, null]);
    expect(r.level).toBe(3);
    expect(r.cohort?.attempted).toBe(4);
    expect(r.cohort?.bands[0]).toMatchObject({ scorePercent: 60, studentsAtOrAbove: 3, passed: true });
    expect(r.cohort?.bands[0]?.pctOfStudents).toBeCloseTo(75, 12);
  });

  it('level 2: [45,44,40,30] → ≥45: 25% fail; ≥39.975 (53.3%): 75% pass', () => {
    expect(levelOf([45, 44, 40, 30]).level).toBe(2);
  });

  it('level 1 with the cohort exactly on 50%: [40,36,30,20] → ≥35.025 (46.7%): 2/4 = 50% pass', () => {
    const r = levelOf([40, 36, 30, 20]);
    expect(r.level).toBe(1);
    expect(r.cohort?.matched).toMatchObject({ scorePercent: 46.7, level: 1 });
  });

  it('level 0 when no band passes — the Procedure’s "otherwise 0"', () => {
    const r = levelOf([30, 20, 10]);
    expect(r.level).toBe(0);
    expect(r.cohort?.matched).toBeNull();
  });

  it('a cohort exactly on 50% at the top band earns level 3: [45,45,30,30]', () => {
    expect(levelOf([45, 45, 30, 30]).level).toBe(3);
  });

  it('documented behaviour of the confirmed §4.3 defaults: exactly 35 of 75 does NOT clear the 46.7% cut-off', () => {
    // 35/75 = 46.666…% < 46.7%. The Procedure's integer cut-off for a
    // 75-mark paper was "at least 35"; the confirmed percentage default
    // places the cut at 35.025. Flagged to the college; a change is a
    // change request against §4.3, and this test documents the baseline.
    expect(levelOf([35, 35, 35, 35]).level).toBe(0);
  });

  it('no marks at all → level null plus a warning, never 0 (§5.1)', () => {
    const { results, warnings } = step4AssessmentCoLevels(endsem([null, null]), ['co1'], makeParams());
    expect(results[0]?.level).toBeNull();
    expect(results[0]?.cohort?.level).toBeNull();
    expect(warnings.some((w) => w.code === 'ITEM_NO_ATTEMPTS' && w.ref.assessmentId === 'es')).toBe(true);
  });

  it('untagged cohort-band assessment (the end-semester norm) applies to every CO', () => {
    const untagged: Assessment = { ...endsem([60, 60, 30, 30]) };
    delete untagged.coTags;
    // ≥45: 2/4 = 50% ≥ 50 → level 3 for every CO.
    const { results, warnings } = step4AssessmentCoLevels(untagged, ['co1', 'co2'], makeParams());
    expect(results.map((r) => ({ coId: r.coId, level: r.level }))).toEqual([
      { coId: 'co1', level: 3 },
      { coId: 'co2', level: 3 },
    ]);
    expect(warnings.some((w) => w.code === 'ASSESSMENT_UNTAGGED')).toBe(true);
  });
});
