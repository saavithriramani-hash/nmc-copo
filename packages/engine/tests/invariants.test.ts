import { describe, expect, it } from 'vitest';
import { EngineAssertionError, assertPercentInRange, countPctGte, ratioGte } from '../src/index';

describe('assertPercentInRange — percentages must lie in [0, 100] (§9)', () => {
  it('accepts the boundaries and interior values', () => {
    expect(() => assertPercentInRange(0, 'test')).not.toThrow();
    expect(() => assertPercentInRange(100, 'test')).not.toThrow();
    expect(() => assertPercentInRange(53.3, 'test')).not.toThrow();
  });

  it('throws — not warns — outside the range', () => {
    expect(() => assertPercentInRange(100.0001, 'test')).toThrow(EngineAssertionError);
    expect(() => assertPercentInRange(-0.0001, 'test')).toThrow(EngineAssertionError);
    expect(() => assertPercentInRange(250, 'inverted ratio')).toThrow(EngineAssertionError);
  });

  it('throws on NaN — NaN never impersonates a valid percentage', () => {
    expect(() => assertPercentInRange(Number.NaN, 'test')).toThrow(EngineAssertionError);
  });
});

describe('ratioGte — exact threshold comparison at decimal boundaries', () => {
  // Marks exactly on the 70% threshold MUST clear (§4.1). Each of these
  // would be at the mercy of float rounding under `mark >= 0.7 * max`.
  it('a mark exactly on the threshold clears, for every common maximum', () => {
    expect(ratioGte(0.7, 1, 0.7)).toBe(true); // 1-mark item
    expect(ratioGte(1.4, 2, 0.7)).toBe(true); // 2-mark item
    expect(ratioGte(3.5, 5, 0.7)).toBe(true); // 5-mark item
    expect(ratioGte(7, 10, 0.7)).toBe(true); // 10-mark item
    expect(ratioGte(10.5, 15, 0.7)).toBe(true); // 15-mark item
    expect(ratioGte(45, 75, 0.6)).toBe(true); // end-sem: 45/75 exactly 60%
  });

  it('a mark just below the threshold does not clear', () => {
    expect(ratioGte(3.49, 5, 0.7)).toBe(false);
    expect(ratioGte(6.75, 10, 0.7)).toBe(false);
    expect(ratioGte(1, 2, 0.7)).toBe(false);
    expect(ratioGte(44, 75, 0.6)).toBe(false);
  });
});

describe('countPctGte — exact band comparison by integer cross-multiplication', () => {
  it('cohort percentages exactly on 80 / 60 / 40 satisfy those bounds', () => {
    expect(countPctGte(4, 5, 80)).toBe(true); // 80% exactly
    expect(countPctGte(3, 5, 60)).toBe(true); // 60% exactly
    expect(countPctGte(2, 5, 40)).toBe(true); // 40% exactly
    expect(countPctGte(2, 4, 50)).toBe(true); // 50% exactly (cohort bands)
  });

  it('just below a bound fails it', () => {
    expect(countPctGte(799, 1000, 80)).toBe(false); // 79.9%
    expect(countPctGte(599, 1000, 60)).toBe(false); // 59.9%
    expect(countPctGte(399, 1000, 40)).toBe(false); // 39.9%
    expect(countPctGte(1, 5, 40)).toBe(false); // 20%
  });
});
