import { DEFAULT_CATEGORY_BANDS, type CategoryBandRow } from '@copo/engine';

/**
 * Resolving the slow/advanced learner band table (CR-8) — pure, so it can
 * be tested without a database. `lib/learnerCategories.ts` is the
 * server-only half that reads the rows.
 */

/** Which band table was applied, and where it came from (§4). */
export interface AppliedBands {
  bands: CategoryBandRow[];
  source: 'programme' | 'institution' | 'default';
}

/**
 * Shaped like the §4 resolution the ten steps use — programme over
 * institution — but with a third outcome the attainment parameters cannot
 * have: nothing configured anywhere. That is not an error here. A college
 * which never opens this report should not be made to fill in a table,
 * and the report says which of the three it used.
 *
 * A stored table that does not parse falls through to the next level
 * rather than throwing. The engine refuses a table with no floor, so a
 * malformed one would take down the page; the fallback is visible in the
 * `source` the report prints, so it cannot pass unnoticed.
 */
export function resolveCategoryBands(programmeBands: unknown, institutionBands: unknown): AppliedBands {
  const fromProgramme = parseBands(programmeBands);
  if (fromProgramme) return { bands: fromProgramme, source: 'programme' };
  const fromInstitution = parseBands(institutionBands);
  if (fromInstitution) return { bands: fromInstitution, source: 'institution' };
  return { bands: [...DEFAULT_CATEGORY_BANDS], source: 'default' };
}

export function parseBands(value: unknown): CategoryBandRow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: CategoryBandRow[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { lowerPercent, category } = entry as Record<string, unknown>;
    if (typeof lowerPercent !== 'number' || !Number.isFinite(lowerPercent)) return null;
    if (lowerPercent < 0 || lowerPercent > 100) return null;
    if (typeof category !== 'string' || category.trim() === '') return null;
    rows.push({ lowerPercent, category: category.trim() });
  }
  // Two rows starting at the same score would make the category depend on
  // sort order rather than on the score.
  if (new Set(rows.map((r) => r.lowerPercent)).size !== rows.length) return null;
  // Without a floor the engine throws, by design: every score must land
  // somewhere and no student may fall off the bottom unlabelled.
  return rows.some((r) => r.lowerPercent <= 0) ? rows : null;
}
