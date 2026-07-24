import { describe, expect, it } from 'vitest';
import { step1ArticulationWeightages, step10PoAttainment } from '../src/index';
import type { FinalCoAttainment, PoMatrix } from '../src/index';
import { makeCo } from './fixtures/helpers';

function mkFinal(coId: string, final: number | null): FinalCoAttainment {
  return {
    procedureStep: 9,
    coId,
    groupTerms: [],
    direct: final,
    indirect: null,
    directWeight: 0.9,
    indirectWeight: 0.1,
    directOnly: true,
    final,
    targetAttainment: 2.5,
    belowTarget: final === null ? null : final < 2.5,
  };
}

const cos = [makeCo('co1'), makeCo('co2'), makeCo('co3')];
const matrix: PoMatrix = {
  co1: { po1: 3, po2: 1 },
  co2: { po1: 2, po2: null },
  co3: { po1: 3, po2: 2 },
};

describe('Step 10 — official and secondary PO projection', () => {
  it('official = weightage × mean(final) / 3; secondary = Σ(strength × final) / Σ(strength)', () => {
    // e2e numbers: finals 2.115 / 2.05 / 2.21, mean = 6.375/3 = 2.125.
    // po1: weightage 8/3 → official (8/3)(2.125)/3 = 17/9 = 1.888…
    //      secondary (3×2.115 + 2×2.05 + 3×2.21)/8 = 17.075/8 = 2.134375
    // po2: weightage 1.5 → official 1.5(2.125)/3 = 1.0625
    //      secondary (1×2.115 + 2×2.21)/3 = 6.535/3 = 2.178333…
    const step1 = step1ArticulationWeightages(cos, matrix).result;
    const { results, warnings } = step10PoAttainment(step1, [
      mkFinal('co1', 2.115),
      mkFinal('co2', 2.05),
      mkFinal('co3', 2.21),
    ]);

    const po1 = results.find((p) => p.poId === 'po1')!;
    expect(po1.meanFinalCo).toBeCloseTo(2.125, 12);
    expect(po1.contributingCoIds).toEqual(['co1', 'co2', 'co3']);
    expect(po1.official).toBeCloseTo(17 / 9, 12);
    expect(po1.secondary).toBeCloseTo(2.134375, 12);

    const po2 = results.find((p) => p.poId === 'po2')!;
    expect(po2.official).toBeCloseTo(1.0625, 12);
    expect(po2.secondary).toBeCloseTo(6.535 / 3, 12);
    expect(po2.secondaryTerms.map((t) => t.coId)).toEqual(['co1', 'co3']); // co2 unmapped to po2

    expect(warnings).toEqual([]);
  });

  it('the same course-wide mean feeds every PO (the Procedure’s method)', () => {
    const step1 = step1ArticulationWeightages(cos, matrix).result;
    const { results } = step10PoAttainment(step1, [mkFinal('co1', 3), mkFinal('co2', 2), mkFinal('co3', 1)]);
    const means = new Set(results.map((p) => p.meanFinalCo));
    expect(means.size).toBe(1);
    expect([...means][0]).toBeCloseTo(2, 12);
  });

  it('a CO without a final is excluded from the mean AND from both secondary sums; weightage stays matrix-driven', () => {
    // finals co1=3, co2=null, co3=2 → mean over {3,2} = 2.5.
    // po1 weightage still (3+2+3)/3 = 8/3 — a property of the matrix.
    // official = (8/3)(2.5)/3 = 20/9.  secondary = (3×3 + 3×2)/(3+3) = 2.5
    //   — co2's strength 2 appears in NEITHER numerator NOR denominator.
    const step1 = step1ArticulationWeightages(cos, matrix).result;
    const { results } = step10PoAttainment(step1, [mkFinal('co1', 3), mkFinal('co2', null), mkFinal('co3', 2)]);

    const po1 = results.find((p) => p.poId === 'po1')!;
    expect(po1.weightage).toBeCloseTo(8 / 3, 12);
    expect(po1.meanFinalCo).toBeCloseTo(2.5, 12);
    expect(po1.contributingCoIds).toEqual(['co1', 'co3']);
    expect(po1.official).toBeCloseTo(20 / 9, 12);
    expect(po1.secondary).toBeCloseTo(2.5, 12);
    expect(po1.secondaryTerms).toEqual([
      { coId: 'co1', strength: 3, final: 3 },
      { coId: 'co3', strength: 3, final: 2 },
    ]);
  });

  it('an unmapped PO stays null through Step 10 (PO_UNMAPPED already raised in Step 1)', () => {
    const withUnmapped: PoMatrix = {
      co1: { po1: 3, poX: null },
      co2: { po1: 2, poX: null },
      co3: { po1: 3, poX: null },
    };
    const step1 = step1ArticulationWeightages(cos, withUnmapped).result;
    const { results, warnings } = step10PoAttainment(step1, [mkFinal('co1', 2), mkFinal('co2', 2), mkFinal('co3', 2)]);
    const poX = results.find((p) => p.poId === 'poX')!;
    expect(poX.weightage).toBeNull();
    expect(poX.official).toBeNull();
    expect(poX.secondary).toBeNull();
    expect(warnings).toEqual([]); // no duplicate warning here
  });

  it('no CO has a final at all → every PO null + NO_ASSESSED_COS (never zero)', () => {
    const step1 = step1ArticulationWeightages(cos, matrix).result;
    const { results, warnings } = step10PoAttainment(step1, [
      mkFinal('co1', null),
      mkFinal('co2', null),
      mkFinal('co3', null),
    ]);
    expect(results.every((p) => p.official === null && p.secondary === null)).toBe(true);
    expect(warnings).toEqual([expect.objectContaining({ code: 'NO_ASSESSED_COS' })]);
  });
});
