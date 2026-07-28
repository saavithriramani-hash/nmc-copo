import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '@copo/engine';
import {
  draftFromParameters,
  parseParametersDraft,
  weightSum,
  type ParametersDraft,
} from '../lib/institutionParams';

/**
 * Institution bands and weights (§4.2-§4.4). Pure — no database.
 *
 * These numbers decide every attainment figure the college reports, so
 * the screen must be unable to store a set the engine would refuse. The
 * checks below lean on the engine's own validateParameters rather than
 * duplicating its rules, and pin the failure cases a user can actually
 * cause: weights that miss 1.00, a band table with no lower-bound-0 row,
 * a level outside 0-3.
 */

const base = draftFromParameters(DEFAULT_PARAMETERS);
const parse = (draft: ParametersDraft) => parseParametersDraft(draft, DEFAULT_PARAMETERS);
const errs = (draft: ParametersDraft): string[] => {
  const result = parse(draft);
  if (!('errors' in result)) throw new Error('expected errors');
  return result.errors;
};
const ok = (draft: ParametersDraft) => {
  const result = parse(draft);
  if ('errors' in result) throw new Error(`unexpected errors: ${result.errors.join('; ')}`);
  return result.parameters;
};

describe('round trip', () => {
  it('reproduces the confirmed defaults unchanged', () => {
    const parameters = ok(base);
    expect(parameters.bands).toEqual(DEFAULT_PARAMETERS.bands);
    expect(parameters.cohortBands).toEqual(DEFAULT_PARAMETERS.cohortBands);
    expect(parameters.weightGroups).toEqual(DEFAULT_PARAMETERS.weightGroups);
    expect(parameters.directWeight).toBe(0.9);
    expect(parameters.indirectWeight).toBe(0.1);
  });

  it('carries through the fields this screen does not edit', () => {
    // The threshold is a course-level concern; the target is per programme.
    const parameters = ok(base);
    expect(parameters.thresholdFraction).toBe(DEFAULT_PARAMETERS.thresholdFraction);
    expect(parameters.targetAttainment).toBe(DEFAULT_PARAMETERS.targetAttainment);
    expect(parameters.feedbackResponseFloor).toBe(DEFAULT_PARAMETERS.feedbackResponseFloor);
  });
});

describe('weight groups must sum to 1.00', () => {
  it('rejects a total below 1', () => {
    const draft = { ...base, weightGroups: [{ name: 'internal', weight: '0.2' }, { name: 'external', weight: '0.7' }] };
    expect(errs(draft).join(' ')).toMatch(/sum to 1\.00/);
  });

  it('rejects a total above 1', () => {
    const draft = { ...base, weightGroups: base.weightGroups.map((g) => ({ ...g, weight: '0.5' })) };
    expect(errs(draft).join(' ')).toMatch(/sum to 1\.00/);
  });

  it('accepts a different but valid split', () => {
    const draft = {
      ...base,
      weightGroups: [
        { name: 'internal', weight: '0.3' },
        { name: 'continuous', weight: '0.1' },
        { name: 'external', weight: '0.6' },
      ],
    };
    expect(ok(draft).weightGroups).toEqual({ internal: 0.3, continuous: 0.1, external: 0.6 });
  });

  it('rejects a duplicate group name rather than silently dropping one', () => {
    const draft = {
      ...base,
      weightGroups: [
        { name: 'internal', weight: '0.5' },
        { name: 'internal', weight: '0.5' },
      ],
    };
    expect(errs(draft).join(' ')).toMatch(/appears twice/);
  });

  it('rejects a nameless group', () => {
    const draft = { ...base, weightGroups: [...base.weightGroups, { name: '  ', weight: '0' }] };
    expect(errs(draft).join(' ')).toMatch(/name is required/);
  });

  it('totals the rows live, ignoring blanks', () => {
    expect(weightSum([{ name: 'a', weight: '0.2' }, { name: 'b', weight: '0.8' }])).toBeCloseTo(1, 10);
    expect(weightSum([{ name: 'a', weight: '0.2' }, { name: 'b', weight: '' }])).toBeCloseTo(0.2, 10);
  });
});

describe('direct and indirect blend', () => {
  it('rejects a blend that does not reach 1.00', () => {
    expect(errs({ ...base, directWeight: '0.8', indirectWeight: '0.1' }).join(' ')).toMatch(/sum to 1\.00/);
  });

  it('accepts a direct-only college (1.0 / 0)', () => {
    const parameters = ok({ ...base, directWeight: '1', indirectWeight: '0' });
    expect(parameters.directWeight).toBe(1);
    expect(parameters.indirectWeight).toBe(0);
  });

  it('requires both figures', () => {
    expect(errs({ ...base, indirectWeight: '' }).join(' ')).toMatch(/indirect weight is required/i);
  });
});

describe('attainment bands', () => {
  it('rejects a table with no lower-bound-0 row, which would leave results unmatched', () => {
    const draft = {
      ...base,
      bands: [
        { lowerBound: '80', level: '3' },
        { lowerBound: '60', level: '2' },
      ],
    };
    expect(errs(draft).length).toBeGreaterThan(0);
  });

  it('rejects a level outside 0-3', () => {
    const draft = { ...base, bands: [...base.bands, { lowerBound: '90', level: '4' }] };
    expect(errs(draft).join(' ')).toMatch(/level/i);
  });

  it('rejects a lower bound outside 0-100', () => {
    const draft = { ...base, bands: [...base.bands, { lowerBound: '120', level: '3' }] };
    expect(errs(draft).join(' ')).toMatch(/\[0, 100\]|lower bound/i);
  });

  it('rejects a duplicate lower bound', () => {
    const draft = { ...base, bands: [...base.bands, { lowerBound: '80', level: '1' }] };
    expect(errs(draft).join(' ')).toMatch(/duplicate/i);
  });

  it('rejects an incomplete row rather than guessing', () => {
    const draft = { ...base, bands: [...base.bands, { lowerBound: '90', level: '' }] };
    expect(errs(draft).join(' ')).toMatch(/lower bound and a level are required/);
  });

  it('accepts a stricter college-wide table', () => {
    const draft = {
      ...base,
      bands: [
        { lowerBound: '90', level: '3' },
        { lowerBound: '70', level: '2' },
        { lowerBound: '50', level: '1' },
        { lowerBound: '0', level: '0' },
      ],
    };
    expect(ok(draft).bands).toEqual([
      { lowerBound: 90, level: 3 },
      { lowerBound: 70, level: 2 },
      { lowerBound: 50, level: 1 },
      { lowerBound: 0, level: 0 },
    ]);
  });
});

describe('end-semester cohort bands', () => {
  it('accepts the confirmed §4.3 table', () => {
    expect(ok(base).cohortBands).toEqual(DEFAULT_PARAMETERS.cohortBands);
  });

  it('rejects a percentage outside 0-100', () => {
    const draft = { ...base, cohortBands: [{ scorePercent: '120', cohortPercent: '50', level: '3' }] };
    expect(errs(draft).join(' ')).toMatch(/\[0, 100\]/);
  });

  it('rejects a duplicated level, which would make the outcome order-dependent', () => {
    const draft = {
      ...base,
      cohortBands: [
        { scorePercent: '60', cohortPercent: '50', level: '3' },
        { scorePercent: '55', cohortPercent: '50', level: '3' },
      ],
    };
    expect(errs(draft).join(' ')).toMatch(/duplicate level/i);
  });

  it('requires every figure in a row', () => {
    const draft = { ...base, cohortBands: [{ scorePercent: '60', cohortPercent: '', level: '3' }] };
    expect(errs(draft).join(' ')).toMatch(/are all required/);
  });
});

describe('error messages', () => {
  it('explains the weight rule in the college’s terms, not the engine’s', () => {
    const draft = { ...base, weightGroups: [{ name: 'internal', weight: '0.5' }] };
    expect(errs(draft).join(' ')).toMatch(/add up to exactly 1\.00/);
  });
});
