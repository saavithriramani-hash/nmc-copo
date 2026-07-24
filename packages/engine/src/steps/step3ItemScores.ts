import { assertPercentInRange } from '../assert';
import { countPctGte, ratioGte } from '../compare';
import { EngineAssertionError } from '../errors';
import type { Assessment, BandRow, EngineWarning, Item, ItemScore, Level, Parameters } from '../types';
import { makeWarning } from '../util';

/**
 * Rubric band lookup (§4.2): highest lowerBound satisfied wins. The band
 * decision uses exact integer cross-multiplication (see compare.ts), so a
 * cohort percentage of exactly 80, 60 or 40 lands on 3, 2, 1 with no
 * floating-point error. Validation guarantees a lowerBound-0 row, so a
 * match always exists.
 */
export function lookupBand(cleared: number, attempted: number, bands: BandRow[]): BandRow {
  const sorted = [...bands].sort((a, b) => b.lowerBound - a.lowerBound);
  for (const band of sorted) {
    if (countPctGte(cleared, attempted, band.lowerBound)) return band;
  }
  throw new EngineAssertionError('band table has no matching row despite a lowerBound-0 row being validated');
}

interface PhysicalItem {
  item: Item;
  sectionId: string | null;
  appliesToCoIds: string[];
}

/** Flattens an assessment into scoreable items with resolved CO applicability. */
function physicalItems(assessment: Assessment, courseCoIds: string[]): PhysicalItem[] {
  const applies = (coTag: string | null): string[] => (coTag === null ? [...courseCoIds] : [coTag]);

  if (assessment.shape === 'SECTIONED') {
    return (assessment.sections ?? []).flatMap((section) =>
      section.items.map((item) => ({ item, sectionId: section.id, appliesToCoIds: applies(item.coTag) })),
    );
  }
  if (assessment.shape === 'ITEM_LIST') {
    return (assessment.items ?? []).map((item) => ({ item, sectionId: null, appliesToCoIds: applies(item.coTag) }));
  }
  // SINGLE_SCORE scored as one pseudo-item whose id is the assessment id.
  const maxMark = assessment.maxMark;
  if (maxMark === undefined) {
    throw new EngineAssertionError(`SINGLE_SCORE assessment '${assessment.id}' has no maxMark despite validation`);
  }
  const tags = assessment.coTags ?? [];
  return [
    {
      item: { id: assessment.id, maxMark, coTag: null },
      sectionId: null,
      appliesToCoIds: tags.length > 0 ? [...tags] : [...courseCoIds],
    },
  ];
}

/**
 * Procedure Step 3 — score every item of a RUBRIC assessment.
 *
 * Per item: attempted = students with a non-null mark (blank = did not
 * attempt, excluded from the denominator; zero = attempted, included);
 * cleared = marks ≥ thresholdFraction × maximum, decided by exact ratio
 * comparison so a mark exactly on the threshold counts as attained (§4.1);
 * pct = cleared/attempted × 100, guarded against attempted = 0 and asserted
 * to lie in [0, 100]; level read from the band table.
 *
 * An item nobody attempted gets pct/level null and an ITEM_NO_ATTEMPTS
 * warning — never a silent zero (§5.1).
 */
export function step3ScoreItems(
  assessment: Assessment,
  courseCoIds: string[],
  parameters: Parameters,
): { itemScores: ItemScore[]; warnings: EngineWarning[] } {
  if (assessment.scoringRule !== 'RUBRIC') {
    throw new EngineAssertionError(
      `step3ScoreItems scores RUBRIC assessments only; '${assessment.id}' is ${assessment.scoringRule} (scored in Step 4)`,
    );
  }

  const warnings: EngineWarning[] = [];
  const { thresholdFraction, bands } = parameters;
  const markRows = Object.values(assessment.marks);

  const itemScores: ItemScore[] = physicalItems(assessment, courseCoIds).map(({ item, sectionId, appliesToCoIds }) => {
    let attempted = 0;
    let cleared = 0;
    for (const row of markRows) {
      const mark = row[item.id] ?? null; // a missing key means "did not attempt"
      if (mark === null) continue;
      attempted += 1;
      if (ratioGte(mark, item.maxMark, thresholdFraction)) cleared += 1;
    }

    const base = {
      procedureStep: 3 as const,
      assessmentId: assessment.id,
      sectionId,
      itemId: item.id,
      maxMark: item.maxMark,
      thresholdFraction,
      thresholdMark: thresholdFraction * item.maxMark,
      appliesToCoIds,
      attempted,
      cleared,
    };

    if (attempted === 0) {
      warnings.push(
        makeWarning(
          'ITEM_NO_ATTEMPTS',
          'warning',
          `No student attempted item '${item.id}' of '${assessment.name}'; it is excluded from CO aggregation.`,
          sectionId === null
            ? { assessmentId: assessment.id, itemId: item.id }
            : { assessmentId: assessment.id, sectionId, itemId: item.id },
        ),
      );
      return { ...base, pct: null, matchedBand: null, level: null };
    }

    const pct = (cleared / attempted) * 100;
    assertPercentInRange(pct, `item '${item.id}' of assessment '${assessment.id}'`);
    const matchedBand = lookupBand(cleared, attempted, bands);
    const level: Level = matchedBand.level;
    return { ...base, pct, matchedBand, level };
  });

  return { itemScores, warnings };
}
