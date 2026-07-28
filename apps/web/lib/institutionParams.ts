import { validateParameters } from '@copo/engine';
import type { BandRow, CohortBandRow, Parameters } from '@copo/engine';

/**
 * Institution-level attainment bands and weights (§4.2, §4.3, §4.4).
 *
 * These are institution-wide accreditation policy: the band table that
 * turns a cohort proportion into a level, the end-semester cohort bands,
 * the Step 9 weight groups, and the direct/indirect blend. They are set
 * once for the college and are NOT offered as programme or course
 * overrides — unlike the rubric threshold, which a HoD may vary per
 * course for a minuted exception.
 *
 * Parsing is pure and the result is checked by the ENGINE'S OWN
 * `validateParameters`, not by a re-implementation here, so the screen
 * can never store a parameter set the engine would refuse to compute
 * with — weights that miss 1.00, a band table with no lower-bound-0 row,
 * a level outside 0-3.
 */

export interface BandDraft {
  lowerBound: string;
  level: string;
}
export interface CohortBandDraft {
  scorePercent: string;
  cohortPercent: string;
  level: string;
}
export interface WeightDraft {
  name: string;
  weight: string;
}
export interface ParametersDraft {
  bands: BandDraft[];
  cohortBands: CohortBandDraft[];
  weightGroups: WeightDraft[];
  directWeight: string;
  indirectWeight: string;
}

export type ParseOutcome = { errors: string[] } | { parameters: Parameters };

const num = (raw: string): number | null => {
  const trimmed = raw.trim().replace(/%$/, '').trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

/**
 * Turns the edited draft into a full parameter set, carrying through the
 * fields this screen does not edit (threshold, target, feedback floor) so
 * the engine validates a complete, coherent set rather than a fragment.
 */
export function parseParametersDraft(draft: ParametersDraft, unchanged: Parameters): ParseOutcome {
  const errors: string[] = [];

  const bands: BandRow[] = [];
  draft.bands.forEach((row, i) => {
    const lowerBound = num(row.lowerBound);
    const level = num(row.level);
    if (lowerBound === null || level === null) {
      errors.push(`Attainment band ${i + 1}: both a lower bound and a level are required.`);
      return;
    }
    bands.push({ lowerBound, level: level as BandRow['level'] });
  });

  const cohortBands: CohortBandRow[] = [];
  draft.cohortBands.forEach((row, i) => {
    const scorePercent = num(row.scorePercent);
    const cohortPercent = num(row.cohortPercent);
    const level = num(row.level);
    if (scorePercent === null || cohortPercent === null || level === null) {
      errors.push(`End-semester band ${i + 1}: score %, cohort % and level are all required.`);
      return;
    }
    cohortBands.push({ scorePercent, cohortPercent, level: level as CohortBandRow['level'] });
  });

  const weightGroups: Record<string, number> = {};
  draft.weightGroups.forEach((row, i) => {
    const name = row.name.trim();
    const weight = num(row.weight);
    if (name === '') {
      errors.push(`Weight group ${i + 1}: a name is required.`);
      return;
    }
    if (weight === null) {
      errors.push(`Weight group '${name}': a weight is required.`);
      return;
    }
    if (weightGroups[name] !== undefined) {
      errors.push(`Weight group '${name}' appears twice; names must be unique.`);
      return;
    }
    weightGroups[name] = weight;
  });

  const directWeight = num(draft.directWeight);
  const indirectWeight = num(draft.indirectWeight);
  if (directWeight === null) errors.push('The direct weight is required.');
  if (indirectWeight === null) errors.push('The indirect weight is required.');

  if (errors.length > 0) return { errors };

  const parameters: Parameters = {
    ...unchanged,
    bands,
    cohortBands,
    weightGroups,
    directWeight: directWeight!,
    indirectWeight: indirectWeight!,
  };

  // The engine has the final word.
  const issues = validateParameters(parameters);
  if (issues.length > 0) return { errors: issues.map((issue) => explain(issue.code, issue.message)) };

  return { parameters };
}

/**
 * The engine's messages are precise but written for a developer reading
 * a stack trace. These are the same facts for someone deciding college
 * policy.
 */
function explain(code: string, message: string): string {
  switch (code) {
    case 'BAD_WEIGHTS':
      return `${message}. Weight groups must add up to exactly 1.00, and the direct and indirect weights must add up to 1.00.`;
    case 'BAD_BANDS':
      return `${message}. The attainment band table needs one row per level, and a row with lower bound 0 so that every result matches something.`;
    case 'BAD_COHORT_BANDS':
      return `${message}. End-semester bands are percentages of the paper maximum, so a 100-, 75- or 50-mark paper works unchanged.`;
    default:
      return message;
  }
}

export function draftFromParameters(parameters: Parameters): ParametersDraft {
  return {
    bands: parameters.bands.map((b) => ({ lowerBound: String(b.lowerBound), level: String(b.level) })),
    cohortBands: parameters.cohortBands.map((b) => ({
      scorePercent: String(b.scorePercent),
      cohortPercent: String(b.cohortPercent),
      level: String(b.level),
    })),
    weightGroups: Object.entries(parameters.weightGroups).map(([name, weight]) => ({
      name,
      weight: String(weight),
    })),
    directWeight: String(parameters.directWeight),
    indirectWeight: String(parameters.indirectWeight),
  };
}

/** Running total shown beside the weight table, so 1.00 is visible while editing. */
export function weightSum(rows: WeightDraft[]): number {
  return rows.reduce((total, row) => total + (num(row.weight) ?? 0), 0);
}
