import { describe, expect, it } from 'vitest';
import {
  describeSource,
  formatThresholdPercent,
  parseThresholdPercent,
  thresholdExample,
} from '../lib/courseThreshold';

/**
 * Course-level rubric threshold override (§4.1). Pure — no database.
 *
 * The threshold decides what counts as attained, so a value that parses
 * wrongly changes real attainment figures. The engine requires a
 * fraction in (0, 1] and the column is Decimal(4,3); both bounds are
 * pinned here, at their edges.
 */

const value = (raw: string) => {
  const result = parseThresholdPercent(raw);
  if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
  return result.value;
};
const error = (raw: string) => {
  const result = parseThresholdPercent(raw);
  if (!('error' in result)) throw new Error(`expected an error for '${raw}'`);
  return result.error;
};

describe('parsing what the HoD typed', () => {
  it('reads a plain percentage as a fraction', () => {
    expect(value('70')).toBe(0.7);
    expect(value('50')).toBe(0.5);
  });

  it('tolerates a trailing % sign and surrounding space', () => {
    expect(value(' 75% ')).toBe(0.75);
  });

  it('treats an empty field as "inherit"', () => {
    expect(value('')).toBeNull();
    expect(value('   ')).toBeNull();
  });

  it('accepts one decimal place, as the Procedure’s 66.7 needs', () => {
    expect(value('66.7')).toBeCloseTo(0.667, 10);
  });

  it('accepts the upper bound of 100%', () => {
    // Full marks required — extreme but legal; the engine allows (0, 1].
    expect(value('100')).toBe(1);
  });

  it('rejects 0% and anything below it', () => {
    // A zero threshold would count every attempt as attained, including
    // a genuine zero score, which is meaningless.
    expect(error('0')).toMatch(/greater than 0/i);
    expect(error('-10')).toMatch(/greater than 0/i);
  });

  it('rejects above 100%', () => {
    expect(error('101')).toMatch(/cannot exceed 100/i);
  });

  it('rejects text', () => {
    expect(error('seventy')).toMatch(/Enter a percentage/i);
  });

  it('rejects precision the Decimal(4,3) column would silently truncate', () => {
    // 70.05% → 0.7005, which the column would store as 0.700 — a
    // different threshold from the one that was typed.
    expect(error('70.05')).toMatch(/one decimal place/i);
  });
});

describe('display', () => {
  it('renders a fraction as the percentage staff talk in', () => {
    expect(formatThresholdPercent(0.7)).toBe('70');
    expect(formatThresholdPercent(0.667)).toBe('66.7');
    expect(formatThresholdPercent(1)).toBe('100');
  });

  it('renders no override as an empty field', () => {
    expect(formatThresholdPercent(null)).toBe('');
    expect(formatThresholdPercent(undefined)).toBe('');
  });

  it('round-trips through parse without drift', () => {
    for (const percent of ['70', '66.7', '75', '100', '40']) {
      expect(formatThresholdPercent(value(percent))).toBe(percent);
    }
  });
});

describe('the worked example shown before saving', () => {
  it('states the mark needed on a given maximum', () => {
    expect(thresholdExample(0.7, 10)).toContain('7');
    expect(thresholdExample(0.7, 5)).toContain('3.5');
  });

  it('reflects the §4.1 note that a 1-mark item needs any non-zero mark', () => {
    // 0.7 × 1 = 0.7, so any mark of 1 clears it.
    expect(thresholdExample(0.7, 1)).toContain('0.7');
  });
});

describe('provenance labels', () => {
  it('names each level distinctly', () => {
    const labels = (['institution', 'programme', 'course'] as const).map(describeSource);
    expect(new Set(labels).size).toBe(3);
    expect(describeSource('course')).toMatch(/override/i);
  });
});
