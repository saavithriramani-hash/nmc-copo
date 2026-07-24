import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, EngineValidationError, step2ResolveParameters } from '../src/index';

describe('Step 2 — parameter resolution: institution → programme → course', () => {
  it('with no overrides everything resolves from the institution', () => {
    const resolved = step2ResolveParameters(DEFAULT_PARAMETERS);
    expect(resolved.procedureStep).toBe(2);
    expect(resolved.parameters).toEqual(DEFAULT_PARAMETERS);
    for (const source of Object.values(resolved.provenance)) {
      expect(source).toBe('institution');
    }
  });

  it('the most specific level wins, field by field, with provenance recorded', () => {
    const resolved = step2ResolveParameters(
      DEFAULT_PARAMETERS,
      { thresholdFraction: 0.6, targetAttainment: 2.0 }, // programme
      { thresholdFraction: 0.5 }, // course (Academic Council minuted exception)
    );

    expect(resolved.parameters.thresholdFraction).toBe(0.5); // course beats programme
    expect(resolved.parameters.targetAttainment).toBe(2.0); // programme beats institution
    expect(resolved.parameters.bands).toEqual(DEFAULT_PARAMETERS.bands); // untouched

    expect(resolved.provenance.thresholdFraction).toBe('course');
    expect(resolved.provenance.targetAttainment).toBe('programme');
    expect(resolved.provenance.bands).toBe('institution');
  });

  it('tables are replaced whole by an overriding level, never merged row-wise', () => {
    const programmeBands = [
      { lowerBound: 50, level: 3 as const },
      { lowerBound: 0, level: 0 as const },
    ];
    const resolved = step2ResolveParameters(DEFAULT_PARAMETERS, { bands: programmeBands });
    expect(resolved.parameters.bands).toEqual(programmeBands); // no default rows survive
    expect(resolved.provenance.bands).toBe('programme');
  });

  it('a resolved set that is inconsistent throws EngineValidationError', () => {
    // Course-level weight groups that do not sum to 1.00.
    expect(() =>
      step2ResolveParameters(DEFAULT_PARAMETERS, undefined, { weightGroups: { internal: 0.5, external: 0.4 } }),
    ).toThrow(EngineValidationError);
  });

  it('the default weight groups sum to 1.00 within float tolerance (0.2 + 0.1 + 0.7)', () => {
    expect(() => step2ResolveParameters(DEFAULT_PARAMETERS)).not.toThrow();
  });
});
