import { describe, expect, it } from 'vitest';
import { computeCourse } from '../src/index';
import { buildE2ECourse } from './fixtures/e2eCourse';
import { makeCo, makeParams } from './fixtures/helpers';

/**
 * The worked end-to-end course. Every expected number is hand-derived in
 * tests/fixtures/e2eCourse.ts — the engine is checked against the
 * derivation, never against its own output.
 */
describe('computeCourse — worked end-to-end course', () => {
  const result = computeCourse(buildE2ECourse());

  it('Step 1 — weightages: po1 = 8/3, po2 = 1.5', () => {
    expect(result.step1.perPo.find((p) => p.poId === 'po1')?.weightage).toBeCloseTo(8 / 3, 12);
    expect(result.step1.perPo.find((p) => p.poId === 'po2')?.weightage).toBeCloseTo(1.5, 12);
  });

  it('Step 3 — item boundaries: exact-80/60/40 items and on-threshold marks land as derived', () => {
    const score = (assessmentId: string, itemId: string) =>
      result.itemScores.find((s) => s.assessmentId === assessmentId && s.itemId === itemId)!;

    // cia1 q2: the S5 zero is attempted (denominator 5), 4/5 = 80% → 3.
    expect(score('cia1', 'q2')).toMatchObject({ attempted: 5, cleared: 4, level: 3 });
    // cia1 q1: the S5 blank is excluded (denominator 4), 3/4 = 75% → 2.
    expect(score('cia1', 'q1')).toMatchObject({ attempted: 4, cleared: 3, level: 2 });
    // cia1 q3: 3.5 exactly on the 70% threshold clears; 3/5 = 60% → 2.
    expect(score('cia1', 'q3')).toMatchObject({ attempted: 5, cleared: 3, level: 2 });
    // cia2 q1: 2/5 = exactly 40% → 1.
    expect(score('cia2', 'q1')).toMatchObject({ attempted: 5, cleared: 2, level: 1 });
    // cia2 q3: 7 exactly on threshold clears; 4/5 = 80% → 3.
    expect(score('cia2', 'q3')).toMatchObject({ attempted: 5, cleared: 4, level: 3 });
  });

  it('Step 4 — assessment CO levels, including the sections-in-which-the-CO-appears rule', () => {
    const level = (assessmentId: string, coId: string) =>
      result.assessmentCo.find((r) => r.assessmentId === assessmentId && r.coId === coId)?.level;

    expect(level('cia1', 'co1')).toBeCloseTo(2, 12); // mean(secA 2, secB 2)
    expect(level('cia1', 'co2')).toBeCloseTo(2, 12); // mean(secA 3, secB 1)
    expect(level('cia2', 'co2')).toBeCloseTo(1, 12); // secA only
    expect(level('cia2', 'co3')).toBeCloseTo(2.5, 12); // mean(secA 2, secB 3)
    expect(level('assign', 'co1')).toBe(3); // untagged → every CO
    expect(level('assign', 'co2')).toBe(3);
    expect(level('assign', 'co3')).toBe(3);
    expect(level('quiz', 'co1')).toBe(2);
    expect(level('quiz', 'co2')).toBe(3);
    expect(level('seminar', 'co3')).toBe(3);
    expect(result.assessmentCo.find((r) => r.assessmentId === 'seminar' && r.coId === 'co1')).toBeUndefined();
    expect(level('endsem', 'co1')).toBe(2); // cohort band level 2 for all COs
    expect(level('endsem', 'co2')).toBe(2);
    expect(level('endsem', 'co3')).toBe(2);
  });

  it('Step 4 drill-down — cia1 co2 traces to secA(q2)=3 and secB(q4)=1', () => {
    const co2 = result.assessmentCo.find((r) => r.assessmentId === 'cia1' && r.coId === 'co2');
    expect(co2?.sections).toEqual([
      { sectionId: 'secA', itemLevels: [{ itemId: 'q2', level: 3 }], level: 3 },
      { sectionId: 'secB', itemLevels: [{ itemId: 'q4', level: 1 }], level: 1 },
    ]);
  });

  it('Step 5 — group consolidation', () => {
    const level = (groupId: string, coId: string) =>
      result.groupCo.find((r) => r.groupId === groupId && r.coId === coId)?.level;

    expect(level('internal', 'co1')).toBeCloseTo(2, 12); // cia1 only
    expect(level('internal', 'co2')).toBeCloseTo(1.5, 12); // mean(2, 1)
    expect(level('internal', 'co3')).toBeCloseTo(2.5, 12); // cia2 only
    expect(level('continuous', 'co1')).toBeCloseTo(2.5, 12); // mean(assign 3, quiz 2)
    expect(level('continuous', 'co2')).toBeCloseTo(3, 12); // mean(3, 3)
    expect(level('continuous', 'co3')).toBeCloseTo(3, 12); // mean(assign 3, seminar 3)
    expect(level('external', 'co1')).toBe(2);
    expect(level('external', 'co2')).toBe(2);
    expect(level('external', 'co3')).toBe(2);
  });

  it('Step 8 — indirect: 2.7 / 2.5 / 2.3', () => {
    expect(result.indirect.find((r) => r.coId === 'co1')?.value).toBeCloseTo(2.7, 12);
    expect(result.indirect.find((r) => r.coId === 'co2')?.value).toBeCloseTo(2.5, 12);
    expect(result.indirect.find((r) => r.coId === 'co3')?.value).toBeCloseTo(2.3, 12);
  });

  it('Step 9 — direct and final, all below the 2.5 target', () => {
    const co = (coId: string) => result.finalCo.find((r) => r.coId === coId)!;

    expect(co('co1').direct).toBeCloseTo(2.05, 12);
    expect(co('co1').final).toBeCloseTo(2.115, 12);
    expect(co('co2').direct).toBeCloseTo(2.0, 12);
    expect(co('co2').final).toBeCloseTo(2.05, 12);
    expect(co('co3').direct).toBeCloseTo(2.2, 12);
    expect(co('co3').final).toBeCloseTo(2.21, 12);
    expect(result.finalCo.every((r) => r.belowTarget === true)).toBe(true);
    expect(result.finalCo.every((r) => r.directOnly === false)).toBe(true);
    // Full group coverage: declared weights used unchanged.
    expect(co('co1').groupTerms.map((t) => t.weightUsed)).toEqual([0.2, 0.1, 0.7]);
  });

  it('Step 10 — official and secondary PO figures', () => {
    const po1 = result.po.find((p) => p.poId === 'po1')!;
    expect(po1.meanFinalCo).toBeCloseTo(2.125, 12);
    expect(po1.official).toBeCloseTo(17 / 9, 12); // (8/3)(2.125)/3
    expect(po1.secondary).toBeCloseTo(2.134375, 12); // 17.075/8

    const po2 = result.po.find((p) => p.poId === 'po2')!;
    expect(po2.official).toBeCloseTo(1.0625, 12); // 1.5(2.125)/3
    expect(po2.secondary).toBeCloseTo(6.535 / 3, 12);
  });

  it('warnings: exactly the two expected untagged-assessment notices, both info', () => {
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((w) => w.code === 'ASSESSMENT_UNTAGGED' && w.severity === 'info')).toBe(true);
    expect(result.warnings.map((w) => w.ref.assessmentId).sort()).toEqual(['assign', 'endsem']);
  });

  it('levels in the item chain are integers (never strings)', () => {
    for (const s of result.itemScores) {
      if (s.level !== null) {
        expect(typeof s.level).toBe('number');
        expect(Number.isInteger(s.level)).toBe(true);
      }
    }
  });

  it('is deterministic: computing the same input twice yields identical results', () => {
    expect(computeCourse(buildE2ECourse())).toEqual(result);
  });

  it('echoes the parameters used, for the report', () => {
    expect(result.parameters).toEqual(buildE2ECourse().parameters);
  });
});

describe('computeCourse — degenerate courses stay defined (§5.1)', () => {
  it('a course with no assessments: everything null, warnings raised, no crash', () => {
    const result = computeCourse({
      cos: [makeCo('co1'), makeCo('co2')],
      poMatrix: { co1: { po1: 3 }, co2: { po1: 2 } },
      parameters: makeParams(),
      assessments: [],
      indirect: {},
    });

    expect(result.finalCo.every((r) => r.final === null)).toBe(true);
    expect(result.po.every((p) => p.official === null)).toBe(true);
    const codes = new Set(result.warnings.map((w) => w.code));
    expect(codes).toContain('EMPTY_WEIGHT_GROUP');
    expect(codes).toContain('CO_NOT_ASSESSED');
    expect(codes).toContain('NO_INDIRECT_DATA');
    expect(codes).toContain('NO_ASSESSED_COS');
  });

  it('a CO assessed nowhere: null final, excluded from PO mean, CO_NOT_ASSESSED raised', () => {
    // Only co1 assessed (single tagged item, 100% → 3; single group weight 1).
    // final(co1) = direct-only? No — indirect co1 = 3 → final = .9(3)+.1(3) = 3.
    // PO mean over co1 alone = 3; po1 weightage = (3+2)/2 = 2.5 → official 2.5×3/3 = 2.5.
    const result = computeCourse({
      cos: [makeCo('co1'), makeCo('co2')],
      poMatrix: { co1: { po1: 3 }, co2: { po1: 2 } },
      parameters: makeParams({ weightGroups: { only: 1 } }),
      assessments: [
        {
          id: 'a1',
          name: 'A1',
          shape: 'ITEM_LIST',
          scoringRule: 'RUBRIC',
          weightGroup: 'only',
          items: [{ id: 'i1', maxMark: 5, coTag: 'co1' }],
          marks: { S1: { i1: 5 }, S2: { i1: 4 } },
        },
      ],
      indirect: { co1: { n1: 0, n2: 0, n3: 10 }, co2: { n1: 0, n2: 0, n3: 10 } },
    });

    expect(result.finalCo.find((r) => r.coId === 'co1')?.final).toBeCloseTo(3, 12);
    expect(result.finalCo.find((r) => r.coId === 'co2')?.final).toBeNull();
    expect(result.warnings.some((w) => w.code === 'CO_NOT_ASSESSED' && w.ref.coId === 'co2')).toBe(true);

    const po1 = result.po.find((p) => p.poId === 'po1')!;
    expect(po1.contributingCoIds).toEqual(['co1']);
    expect(po1.meanFinalCo).toBeCloseTo(3, 12);
    expect(po1.weightage).toBeCloseTo(2.5, 12); // matrix-driven, co2 still counted
    expect(po1.official).toBeCloseTo(2.5, 12);
  });
});
