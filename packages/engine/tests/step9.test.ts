import { describe, expect, it } from 'vitest';
import { step9FinalCoAttainment } from '../src/index';
import type { GroupCoLevel, IndirectResult } from '../src/index';
import { makeParams } from './fixtures/helpers';

function groupRow(groupId: string, coId: string, level: number): GroupCoLevel {
  return { procedureStep: 5, groupId, coId, level, contributions: [] };
}

function indirectRow(coId: string, value: number | null): IndirectResult {
  const responses = value === null ? 0 : 10;
  return { procedureStep: 8, coId, n1: 0, n2: 0, n3: responses, responses, value };
}

const params = makeParams();
const allGroups = ['internal', 'continuous', 'external'];

describe('Step 9 — direct = Σ weight × group level; final = 0.9 × direct + 0.1 × indirect', () => {
  it('reproduces the Procedure’s 0.2 Internal + 0.1 Assignment + 0.7 External with no intermediate averaging', () => {
    // direct = .2(2) + .1(2.5) + .7(2) = 2.05;  final = .9(2.05) + .1(2.7) = 2.115
    const { results, warnings } = step9FinalCoAttainment(
      ['co1'],
      params,
      allGroups,
      [groupRow('internal', 'co1', 2), groupRow('continuous', 'co1', 2.5), groupRow('external', 'co1', 2)],
      [indirectRow('co1', 2.7)],
    );
    const co1 = results[0]!;
    expect(co1.direct).toBeCloseTo(2.05, 12);
    expect(co1.final).toBeCloseTo(2.115, 12);
    expect(co1.directOnly).toBe(false);
    expect(co1.belowTarget).toBe(true); // 2.115 < 2.5
    // Full coverage → weights used are exactly the declared weights.
    expect(co1.groupTerms).toEqual([
      { groupId: 'internal', declaredWeight: 0.2, weightUsed: 0.2, level: 2 },
      { groupId: 'continuous', declaredWeight: 0.1, weightUsed: 0.1, level: 2.5 },
      { groupId: 'external', declaredWeight: 0.7, weightUsed: 0.7, level: 2 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('a final exactly on the target is NOT below target (§4.5)', () => {
    const single = makeParams({ weightGroups: { only: 1 } });
    // direct = 2.5, indirect = 2.5 → final = .9(2.5) + .1(2.5) = 2.5 exactly.
    const { results } = step9FinalCoAttainment(
      ['co1'],
      single,
      ['only'],
      [groupRow('only', 'co1', 2.5)],
      [indirectRow('co1', 2.5)],
    );
    expect(results[0]?.final).toBeCloseTo(2.5, 12);
    expect(results[0]?.belowTarget).toBe(false);

    const below = step9FinalCoAttainment(
      ['co1'],
      single,
      ['only'],
      [groupRow('only', 'co1', 2.4)],
      [indirectRow('co1', 2.4)],
    );
    expect(below.results[0]?.belowTarget).toBe(true);
  });
});

describe('Step 9 — degenerate: a weight group with no assessments (§5.1)', () => {
  it('redistributes the empty group’s weight proportionally and says so', () => {
    // continuous is declared (0.1) but has no assessments.
    // direct = (0.2×3 + 0.7×2) / 0.9 = 2/0.9 = 2.2222…
    const { results, warnings } = step9FinalCoAttainment(
      ['co1'],
      params,
      ['internal', 'external'], // groups that actually have assessments
      [groupRow('internal', 'co1', 3), groupRow('external', 'co1', 2)],
      [indirectRow('co1', null)],
    );
    const co1 = results[0]!;
    expect(co1.direct).toBeCloseTo(2 / 0.9, 12);
    // weightUsed asserted with tolerance: the engine's base is the float
    // sum 0.2 + 0.7, one ulp off the literal 0.9. Hand values: 2/9 and 7/9.
    expect(co1.groupTerms.map((t) => ({ groupId: t.groupId, declaredWeight: t.declaredWeight, level: t.level }))).toEqual([
      { groupId: 'internal', declaredWeight: 0.2, level: 3 },
      { groupId: 'external', declaredWeight: 0.7, level: 2 },
    ]);
    expect(co1.groupTerms[0]?.weightUsed).toBeCloseTo(2 / 9, 12);
    expect(co1.groupTerms[1]?.weightUsed).toBeCloseTo(7 / 9, 12);
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'EMPTY_WEIGHT_GROUP', severity: 'warning', ref: { groupId: 'continuous' } }),
    );
  });

  it('a non-empty group missing one CO renormalises for that CO only, with GROUP_NOT_ASSESSING_CO', () => {
    // internal assesses co1 but not co2. co2: (0.1×3 + 0.7×2)/0.8 = 1.7/0.8 = 2.125.
    const { results, warnings } = step9FinalCoAttainment(
      ['co1', 'co2'],
      params,
      allGroups,
      [
        groupRow('internal', 'co1', 2),
        groupRow('continuous', 'co1', 2),
        groupRow('external', 'co1', 2),
        groupRow('continuous', 'co2', 3),
        groupRow('external', 'co2', 2),
      ],
      [indirectRow('co1', null), indirectRow('co2', null)],
    );
    expect(results[0]?.direct).toBeCloseTo(2, 12); // co1 fully covered
    expect(results[1]?.direct).toBeCloseTo(2.125, 12);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'GROUP_NOT_ASSESSING_CO', ref: { groupId: 'internal', coId: 'co2' } }),
    ]);
  });

  it('a CO assessed nowhere keeps direct/final/belowTarget null with no spurious gap warnings', () => {
    const { results, warnings } = step9FinalCoAttainment(
      ['co1'],
      params,
      allGroups,
      [], // no group produced a value (CO_NOT_ASSESSED was raised in Step 5)
      [indirectRow('co1', 2.5)],
    );
    expect(results[0]).toMatchObject({ direct: null, final: null, belowTarget: null, groupTerms: [] });
    expect(warnings.filter((w) => w.code === 'GROUP_NOT_ASSESSING_CO')).toEqual([]);
  });
});

describe('Step 9 — degenerate: no indirect value (§5.1)', () => {
  it('final = direct, flagged directOnly — the 0.1 share is never zero-filled', () => {
    const { results } = step9FinalCoAttainment(
      ['co1'],
      params,
      allGroups,
      [groupRow('internal', 'co1', 3), groupRow('continuous', 'co1', 3), groupRow('external', 'co1', 3)],
      [indirectRow('co1', null)],
    );
    // direct = 3; with a zero-filled indirect the final would sag to 2.7.
    expect(results[0]?.direct).toBeCloseTo(3, 12);
    expect(results[0]?.final).toBeCloseTo(3, 12);
    expect(results[0]?.directOnly).toBe(true);
  });
});
