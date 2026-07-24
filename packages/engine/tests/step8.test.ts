import { describe, expect, it } from 'vitest';
import { step8IndirectAttainment } from '../src/index';

describe('Step 8 — indirect attainment: (1·n1 + 2·n2 + 3·n3) ÷ N', () => {
  it('computes the weighted mean of the 3-point scale', () => {
    // (1×1 + 2×1 + 3×8) / 10 = 27/10 = 2.7
    const { results, warnings } = step8IndirectAttainment(['co1'], { co1: { n1: 1, n2: 1, n3: 8 } }, 0);
    expect(results[0]).toMatchObject({ coId: 'co1', n1: 1, n2: 1, n3: 8, responses: 10 });
    expect(results[0]?.value).toBeCloseTo(2.7, 12);
    expect(warnings).toEqual([]);
  });

  it('spans the full range: all-1 responses → 1, all-3 responses → 3', () => {
    const { results } = step8IndirectAttainment(
      ['co1', 'co2'],
      { co1: { n1: 7, n2: 0, n3: 0 }, co2: { n1: 0, n2: 0, n3: 7 } },
      0,
    );
    expect(results[0]?.value).toBe(1);
    expect(results[1]?.value).toBe(3);
  });

  it('fewer responses than the configured floor: value still computed, FEEDBACK_BELOW_FLOOR raised (§5.1)', () => {
    // (1×2 + 2×2 + 3×1) / 5 = 9/5 = 1.8, with 5 < floor 10.
    const { results, warnings } = step8IndirectAttainment(['co1'], { co1: { n1: 2, n2: 2, n3: 1 } }, 10);
    expect(results[0]?.value).toBeCloseTo(1.8, 12);
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'FEEDBACK_BELOW_FLOOR', severity: 'warning', ref: { coId: 'co1' } }),
    ]);
  });

  it('a floor of 0 disables the check', () => {
    const { warnings } = step8IndirectAttainment(['co1'], { co1: { n1: 1, n2: 0, n3: 0 } }, 0);
    expect(warnings).toEqual([]);
  });

  it('a CO with zero responses while others have feedback: null value + NO_FEEDBACK_FOR_CO, never 0/0', () => {
    const { results, warnings } = step8IndirectAttainment(
      ['co1', 'co2'],
      { co1: { n1: 0, n2: 0, n3: 4 }, co2: { n1: 0, n2: 0, n3: 0 } },
      0,
    );
    expect(results[0]?.value).toBe(3);
    expect(results[1]?.value).toBeNull();
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'NO_FEEDBACK_FOR_CO', ref: { coId: 'co2' } }),
    ]);
  });

  it('a CO missing from the record entirely behaves like zero responses', () => {
    const { results, warnings } = step8IndirectAttainment(['co1', 'co2'], { co1: { n1: 0, n2: 0, n3: 4 } }, 0);
    expect(results[1]?.value).toBeNull();
    expect(warnings.some((w) => w.code === 'NO_FEEDBACK_FOR_CO' && w.ref.coId === 'co2')).toBe(true);
  });

  it('no feedback anywhere: one NO_INDIRECT_DATA warning, all values null — direct-only course (§5.1)', () => {
    const { results, warnings } = step8IndirectAttainment(['co1', 'co2'], {}, 0);
    expect(results.every((r) => r.value === null)).toBe(true);
    expect(warnings).toEqual([expect.objectContaining({ code: 'NO_INDIRECT_DATA', severity: 'warning' })]);
    // No per-CO spam on top of the course-level warning.
    expect(warnings).toHaveLength(1);
  });
});
