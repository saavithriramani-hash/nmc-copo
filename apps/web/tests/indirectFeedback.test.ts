import { describe, expect, it } from 'vitest';
import { step8IndirectAttainment } from '@copo/engine';
import {
  draftFromStored,
  formatIndirect,
  isEmpty,
  parseCount,
  parseFeedbackDraft,
  responsesOf,
  type FeedbackDraft,
} from '../lib/indirectFeedback';

/**
 * CO-wise indirect feedback entry (Step 8). Pure — no database.
 *
 * The rule that matters is the one blank ≠ zero does NOT cover: these are
 * tallies, so an empty box means nobody chose that option (zero). "No
 * feedback at all" is every count being zero, which must reach the engine
 * as an ABSENT row so it yields a null value, never a measured zero.
 */

const label = (coId: string) => coId.toUpperCase();

describe('parsing a count', () => {
  it('reads whole numbers', () => {
    expect(parseCount('12')).toEqual({ value: 12 });
    expect(parseCount('0')).toEqual({ value: 0 });
  });

  it('treats an empty box as none chose that option', () => {
    // Unlike a mark, where empty means "did not attempt".
    expect(parseCount('')).toEqual({ value: 0 });
    expect(parseCount('   ')).toEqual({ value: 0 });
  });

  it('rejects fractions, negatives and text — responses are countable', () => {
    expect(parseCount('2.5')).toHaveProperty('error');
    expect(parseCount('-3')).toHaveProperty('error');
    expect(parseCount('twelve')).toHaveProperty('error');
  });
});

describe('parsing the whole draft', () => {
  const draft: FeedbackDraft[] = [
    { coId: 'co1', n1: '2', n2: '5', n3: '13' },
    { coId: 'co2', n1: '', n2: '', n3: '' },
  ];

  it('produces counts per CO', () => {
    const result = parseFeedbackDraft(draft, label);
    if ('errors' in result) throw new Error(result.errors.join('; '));
    expect(result.rows).toEqual([
      { coId: 'co1', counts: { n1: 2, n2: 5, n3: 13 } },
      { coId: 'co2', counts: { n1: 0, n2: 0, n3: 0 } },
    ]);
  });

  it('names the outcome and the rating in an error', () => {
    const result = parseFeedbackDraft([{ coId: 'co1', n1: 'x', n2: '1', n3: '1' }], label);
    if (!('errors' in result)) throw new Error('expected errors');
    expect(result.errors[0]).toContain('CO1');
    expect(result.errors[0]).toContain('rating 1');
  });

  it('reports every bad cell, not just the first', () => {
    const result = parseFeedbackDraft([{ coId: 'co1', n1: 'x', n2: 'y', n3: '1' }], label);
    if (!('errors' in result)) throw new Error('expected errors');
    expect(result.errors).toHaveLength(2);
  });
});

describe('empty rows', () => {
  it('recognises a CO with no responses', () => {
    expect(isEmpty({ n1: 0, n2: 0, n3: 0 })).toBe(true);
    expect(isEmpty({ n1: 0, n2: 0, n3: 1 })).toBe(false);
  });

  it('counts responses', () => {
    expect(responsesOf({ n1: 2, n2: 5, n3: 13 })).toBe(20);
  });
});

describe('agreement with the engine', () => {
  // The screen previews with step8IndirectAttainment itself, so these pin
  // the contract rather than a re-implementation.
  it('computes the Procedure formula', () => {
    // (1×2 + 2×5 + 3×13) / 20 = 51/20 = 2.55
    const { results } = step8IndirectAttainment(['co1'], { co1: { n1: 2, n2: 5, n3: 13 } }, 0);
    expect(results[0]!.value).toBeCloseTo(2.55, 10);
    expect(results[0]!.responses).toBe(20);
  });

  it('yields NULL, not zero, for a CO with no feedback', () => {
    // The whole reason an all-zero row is stored as no row.
    const { results } = step8IndirectAttainment(['co1', 'co2'], { co1: { n1: 1, n2: 1, n3: 1 } }, 0);
    const co2 = results.find((r) => r.coId === 'co2')!;
    expect(co2.value).toBeNull();
    expect(co2.responses).toBe(0);
  });

  it('warns when no CO has any feedback', () => {
    const { warnings } = step8IndirectAttainment(['co1'], {}, 0);
    expect(warnings.some((w) => w.code === 'NO_INDIRECT_DATA')).toBe(true);
  });

  it('warns below the response floor but still computes', () => {
    const { results, warnings } = step8IndirectAttainment(['co1'], { co1: { n1: 0, n2: 1, n3: 1 } }, 10);
    expect(results[0]!.value).toBeCloseTo(2.5, 10);
    expect(warnings.some((w) => w.code === 'FEEDBACK_BELOW_FLOOR')).toBe(true);
  });

  it('a floor of 0 disables the check', () => {
    const { warnings } = step8IndirectAttainment(['co1'], { co1: { n1: 0, n2: 1, n3: 1 } }, 0);
    expect(warnings.some((w) => w.code === 'FEEDBACK_BELOW_FLOOR')).toBe(false);
  });

  it('reaches the extremes of the scale', () => {
    const all1 = step8IndirectAttainment(['co1'], { co1: { n1: 9, n2: 0, n3: 0 } }, 0);
    const all3 = step8IndirectAttainment(['co1'], { co1: { n1: 0, n2: 0, n3: 9 } }, 0);
    expect(all1.results[0]!.value).toBe(1);
    expect(all3.results[0]!.value).toBe(3);
  });
});

describe('seeding the draft', () => {
  it('fills stored counts and leaves unrecorded outcomes blank', () => {
    const draft = draftFromStored(['co1', 'co2'], new Map([['co1', { n1: 1, n2: 2, n3: 3 }]]));
    expect(draft).toEqual([
      { coId: 'co1', n1: '1', n2: '2', n3: '3' },
      { coId: 'co2', n1: '', n2: '', n3: '' },
    ]);
  });

  it('shows a stored zero as 0, distinct from an unrecorded blank', () => {
    const draft = draftFromStored(['co1'], new Map([['co1', { n1: 0, n2: 4, n3: 0 }]]));
    expect(draft[0]).toEqual({ coId: 'co1', n1: '0', n2: '4', n3: '0' });
  });
});

describe('display', () => {
  it('shows an absent value as a dash, never 0.000', () => {
    expect(formatIndirect(null)).toBe('—');
    expect(formatIndirect(2.55)).toBe('2.550');
  });
});
