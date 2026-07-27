import { describe, expect, it } from 'vitest';
import {
  BLOOM_LEVELS,
  formatBloomLevels,
  isBloomLevel,
  normaliseBloomLevels,
  validateBloomLevels,
} from '../lib/bloom';

/**
 * Bloom levels on a CO (FR-5, extended to one-or-more). Display-only —
 * no attainment figure depends on these — so the rules that matter are
 * canonical ordering, deduplication, and never storing an empty list.
 */

describe('recognising levels', () => {
  it('accepts the six taxonomy levels and nothing else', () => {
    for (const level of BLOOM_LEVELS) expect(isBloomLevel(level), level).toBe(true);
    expect(isBloomLevel('Synthesise')).toBe(false); // older taxonomy wording
    expect(isBloomLevel('apply')).toBe(false); // case matters: these are display strings
    expect(isBloomLevel('')).toBe(false);
  });
});

describe('canonical form', () => {
  it('orders by the taxonomy, not by the order chosen', () => {
    expect(normaliseBloomLevels(['Create', 'Remember', 'Apply'])).toEqual(['Remember', 'Apply', 'Create']);
  });

  it('removes duplicates', () => {
    expect(normaliseBloomLevels(['Apply', 'Apply', 'Apply'])).toEqual(['Apply']);
  });

  it('drops values that are not levels', () => {
    expect(normaliseBloomLevels(['Apply', 'Nonsense', 'Evaluate'])).toEqual(['Apply', 'Evaluate']);
  });

  it('is idempotent, so re-saving a CO produces no spurious audit difference', () => {
    const once = normaliseBloomLevels(['Evaluate', 'Understand']);
    expect(normaliseBloomLevels(once)).toEqual(once);
  });

  it('keeps a single level a single level', () => {
    expect(normaliseBloomLevels(['Understand'])).toEqual(['Understand']);
  });

  it('preserves all six when all are chosen', () => {
    expect(normaliseBloomLevels([...BLOOM_LEVELS].reverse())).toEqual([...BLOOM_LEVELS]);
  });
});

describe('validation', () => {
  it('accepts one level and several', () => {
    expect(validateBloomLevels(['Apply'])).toBeNull();
    expect(validateBloomLevels(['Understand', 'Apply'])).toBeNull();
  });

  it('rejects an empty list — a CO must still declare its level (FR-5)', () => {
    expect(validateBloomLevels([])).toMatch(/at least one/i);
  });

  it('rejects a list whose only entries are unrecognised', () => {
    expect(validateBloomLevels(['Nonsense'])).toMatch(/Unknown Bloom level/);
  });

  it('names the offending value', () => {
    expect(validateBloomLevels(['Apply', 'Synthesise'])).toContain('Synthesise');
  });
});

describe('display', () => {
  it('joins levels for a report cell', () => {
    expect(formatBloomLevels(['Understand', 'Apply'])).toBe('Understand, Apply');
  });

  it('renders blank rather than throwing for a pre-change immutable snapshot', () => {
    // Snapshots cannot be migrated — a database trigger forbids updating
    // them — so a locked course from before this change has no list.
    expect(formatBloomLevels(undefined)).toBe('');
    expect(formatBloomLevels(null)).toBe('');
    expect(formatBloomLevels([])).toBe('');
  });
});
