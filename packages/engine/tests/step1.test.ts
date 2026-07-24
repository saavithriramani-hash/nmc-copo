import { describe, expect, it } from 'vitest';
import { step1ArticulationWeightages } from '../src/index';
import { makeCo } from './fixtures/helpers';

const cos = [makeCo('co1'), makeCo('co2'), makeCo('co3')];

describe('Step 1 — articulation weightages', () => {
  it('weightage = mean of the CO strengths mapped to each PO', () => {
    // po1: (3+2+3)/3 = 8/3.  po2: co2 is null → (1+2)/2 = 1.5.
    const { result, warnings } = step1ArticulationWeightages(cos, {
      co1: { po1: 3, po2: 1 },
      co2: { po1: 2, po2: null },
      co3: { po1: 3, po2: 2 },
    });

    expect(result.procedureStep).toBe(1);
    expect(result.perPo.map((p) => p.poId)).toEqual(['po1', 'po2']);

    const [po1, po2] = result.perPo;
    expect(po1?.weightage).toBeCloseTo(8 / 3, 12);
    expect(po1?.strengths).toEqual([
      { coId: 'co1', strength: 3 },
      { coId: 'co2', strength: 2 },
      { coId: 'co3', strength: 3 },
    ]);
    expect(po2?.weightage).toBeCloseTo(1.5, 12);
    expect(po2?.strengths).toEqual([
      { coId: 'co1', strength: 1 },
      { coId: 'co3', strength: 2 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('a PO no CO maps to gets weightage null and a PO_UNMAPPED warning — never zero', () => {
    const { result, warnings } = step1ArticulationWeightages(cos, {
      co1: { po1: 3, po3: null },
      co2: { po1: 2, po3: null },
      co3: { po1: 1, po3: null },
    });

    const po3 = result.perPo.find((p) => p.poId === 'po3');
    expect(po3?.weightage).toBeNull();
    expect(po3?.strengths).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'PO_UNMAPPED', severity: 'warning', ref: { poId: 'po3' } });

    // po1 unaffected: (3+2+1)/3 = 2.
    expect(result.perPo.find((p) => p.poId === 'po1')?.weightage).toBeCloseTo(2, 12);
  });

  it('PO order is deterministic: first appearance across CO rows in CO order', () => {
    const { result } = step1ArticulationWeightages(cos, {
      co1: { poB: 1 },
      co2: { poA: 2, poB: 2 },
      co3: { poC: 3 },
    });
    expect(result.perPo.map((p) => p.poId)).toEqual(['poB', 'poA', 'poC']);
  });
});
