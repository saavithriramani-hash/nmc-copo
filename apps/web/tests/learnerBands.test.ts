import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_BANDS } from '@copo/engine';
import { parseBands, resolveCategoryBands } from '../lib/learnerBands';

const GOOD = [
  { lowerPercent: 75, category: 'Advanced' },
  { lowerPercent: 0, category: 'Slow' },
];

describe('resolving the category bands (§4 order)', () => {
  it('prefers the programme table over the institution one', () => {
    const inst = [{ lowerPercent: 0, category: 'Everyone' }];
    expect(resolveCategoryBands(GOOD, inst)).toEqual({ bands: GOOD, source: 'programme' });
  });

  it('falls back to the institution table', () => {
    expect(resolveCategoryBands(null, GOOD)).toEqual({ bands: GOOD, source: 'institution' });
  });

  it("falls back to the engine's default when nothing is configured", () => {
    const resolved = resolveCategoryBands(null, null);
    expect(resolved.source).toBe('default');
    expect(resolved.bands).toEqual([...DEFAULT_CATEGORY_BANDS]);
  });

  it('reports the default as its own source, so the report can say so', () => {
    // The requirement is that every applied override is shown. "Nothing
    // was configured" is a third answer, and must not masquerade as an
    // institution setting.
    expect(resolveCategoryBands(undefined, undefined).source).toBe('default');
  });
});

describe('a stored table that does not parse falls through, it never throws', () => {
  const rejected: [string, unknown][] = [
    ['not an array', { lowerPercent: 0, category: 'Slow' }],
    ['empty', []],
    ['no floor row', [{ lowerPercent: 40, category: 'Pass' }]],
    ['a non-numeric bound', [{ lowerPercent: '0', category: 'Slow' }]],
    ['a bound above 100', [{ lowerPercent: 120, category: 'X' }, { lowerPercent: 0, category: 'Y' }]],
    ['a negative bound', [{ lowerPercent: -5, category: 'X' }]],
    ['a blank category', [{ lowerPercent: 0, category: '   ' }]],
    ['a missing category', [{ lowerPercent: 0 }]],
    ['two rows on the same bound', [
      { lowerPercent: 50, category: 'A' },
      { lowerPercent: 50, category: 'B' },
      { lowerPercent: 0, category: 'C' },
    ]],
    ['NaN', [{ lowerPercent: Number.NaN, category: 'X' }]],
    ['a null entry', [null]],
  ];

  for (const [name, value] of rejected) {
    it(`rejects ${name}`, () => {
      expect(parseBands(value)).toBeNull();
      // …and the resolver keeps going rather than breaking the page.
      expect(resolveCategoryBands(value, null).source).toBe('default');
    });
  }

  it('accepts a well-formed table and trims its labels', () => {
    expect(parseBands([{ lowerPercent: 0, category: '  Slow  ' }])).toEqual([{ lowerPercent: 0, category: 'Slow' }]);
  });

  it('accepts the two-category scheme the college files today', () => {
    const two = [
      { lowerPercent: 70, category: 'AL' },
      { lowerPercent: 0, category: 'SL' },
    ];
    expect(parseBands(two)).toEqual(two);
  });

  it('never returns a table the engine would refuse', () => {
    // The engine throws without a row at 0. Whatever comes out of here
    // must therefore always carry one — including the default.
    for (const [, value] of rejected) {
      expect(resolveCategoryBands(value, value).bands.some((b) => b.lowerPercent <= 0)).toBe(true);
    }
    expect(resolveCategoryBands(GOOD, null).bands.some((b) => b.lowerPercent <= 0)).toBe(true);
  });
});
