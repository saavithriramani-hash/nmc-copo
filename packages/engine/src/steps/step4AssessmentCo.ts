import { assertPercentInRange } from '../assert';
import { countPctGte, ratioGte } from '../compare';
import { EngineAssertionError } from '../errors';
import type {
  Assessment,
  AssessmentCoResult,
  CohortBandStat,
  CohortScore,
  EngineWarning,
  ItemScore,
  Parameters,
  SectionCoTrace,
} from '../types';
import { makeWarning, meanOrNull } from '../util';
import { step3ScoreItems } from './step3ItemScores';

/**
 * Detects an assessment with no CO tags anywhere (§5.1). Defined behaviour
 * per §3.1: it contributes its level to every CO — how the Procedure treats
 * assignments and the end-semester paper — so the warning is informational,
 * making the untagged spread visible on the report rather than changing it.
 */
function untaggedWarning(assessment: Assessment): EngineWarning | null {
  let untagged: boolean;
  if (assessment.shape === 'SECTIONED') {
    untagged = (assessment.sections ?? []).every((s) => s.items.every((i) => i.coTag === null));
  } else if (assessment.shape === 'ITEM_LIST') {
    untagged = (assessment.items ?? []).every((i) => i.coTag === null);
  } else {
    untagged = (assessment.coTags ?? []).length === 0;
  }
  if (!untagged) return null;
  return makeWarning(
    'ASSESSMENT_UNTAGGED',
    'info',
    `'${assessment.name}' has no CO tags; it contributes its level to every CO of the course (§3.1).`,
    { assessmentId: assessment.id },
  );
}

/**
 * Scores a SINGLE_SCORE + COHORT_BAND assessment (Procedure Step 7, §4.3).
 *
 * Band rows are evaluated in descending level order; the first row whose
 * cohort test passes decides the level, else 0. Both comparisons — a
 * student's score against scorePercent of the maximum, and the cohort
 * count against cohortPercent — use the exact helpers in compare.ts, so a
 * student exactly on the score cut-off and a cohort exactly on the bound
 * both count.
 *
 * With no marks at all the level is null plus a warning — never 0 (§5.1).
 */
export function scoreCohortBand(
  assessment: Assessment,
  parameters: Parameters,
): { cohort: CohortScore; warnings: EngineWarning[] } {
  const maxMark = assessment.maxMark;
  if (maxMark === undefined) {
    throw new EngineAssertionError(`COHORT_BAND assessment '${assessment.id}' has no maxMark despite validation`);
  }

  const warnings: EngineWarning[] = [];
  const marks: number[] = [];
  for (const row of Object.values(assessment.marks)) {
    const mark = row[assessment.id] ?? null;
    if (mark !== null) marks.push(mark);
  }
  const attempted = marks.length;

  if (attempted === 0) {
    warnings.push(
      makeWarning('ITEM_NO_ATTEMPTS', 'warning', `No marks entered for '${assessment.name}'; its level cannot be computed.`, {
        assessmentId: assessment.id,
        itemId: assessment.id,
      }),
    );
    return { cohort: { attempted: 0, maxMark, bands: [], matched: null, level: null }, warnings };
  }

  const sorted = [...parameters.cohortBands].sort((a, b) => b.level - a.level);
  const bands: CohortBandStat[] = sorted.map((row) => {
    let studentsAtOrAbove = 0;
    for (const mark of marks) {
      if (ratioGte(mark, maxMark, row.scorePercent / 100)) studentsAtOrAbove += 1;
    }
    const pctOfStudents = (studentsAtOrAbove / attempted) * 100;
    assertPercentInRange(pctOfStudents, `cohort band ${row.scorePercent}% of assessment '${assessment.id}'`);
    return {
      scorePercent: row.scorePercent,
      cohortPercent: row.cohortPercent,
      level: row.level,
      studentsAtOrAbove,
      pctOfStudents,
      passed: countPctGte(studentsAtOrAbove, attempted, row.cohortPercent),
    };
  });

  const matchedStat = bands.find((b) => b.passed) ?? null;
  const matched = matchedStat === null ? null : sorted.find((r) => r.level === matchedStat.level) ?? null;
  return {
    cohort: { attempted, maxMark, bands, matched, level: matchedStat === null ? 0 : matchedStat.level },
    warnings,
  };
}

/**
 * Procedure Step 4 — aggregate item levels to each CO within an assessment.
 *
 * - SECTIONED: mean of item levels per section, then mean across the
 *   sections in which the CO appears — uniformly, never a fixed section
 *   count (§9's "averaged over four sections in one test and three in
 *   another" fault).
 * - ITEM_LIST: mean of the item levels applying to the CO; no section layer.
 * - SINGLE_SCORE + RUBRIC: the single score, scored as one item.
 * - SINGLE_SCORE + COHORT_BAND: §4.3 lookup on the total-score distribution.
 *
 * A result row exists only for COs that appear in the assessment. Item
 * levels of null (nobody attempted) are excluded from every mean, never
 * coerced. Returns the Step 3 item scores it consumed so callers can chain
 * the drill-down.
 */
export function step4AssessmentCoLevels(
  assessment: Assessment,
  courseCoIds: string[],
  parameters: Parameters,
): { results: AssessmentCoResult[]; itemScores: ItemScore[]; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = [];
  const untagged = untaggedWarning(assessment);
  if (untagged) warnings.push(untagged);

  // --- COHORT_BAND (validated to be SINGLE_SCORE) ---
  if (assessment.scoringRule === 'COHORT_BAND') {
    const { cohort, warnings: cohortWarnings } = scoreCohortBand(assessment, parameters);
    warnings.push(...cohortWarnings);
    const tags = assessment.coTags ?? [];
    const appliesTo = tags.length > 0 ? tags : courseCoIds;
    const results: AssessmentCoResult[] = appliesTo.map((coId) => ({
      procedureStep: 4,
      assessmentId: assessment.id,
      coId,
      level: cohort.level,
      cohort,
    }));
    return { results, itemScores: [], warnings };
  }

  // --- RUBRIC: consume Step 3 ---
  const { itemScores, warnings: itemWarnings } = step3ScoreItems(assessment, courseCoIds, parameters);
  warnings.push(...itemWarnings);
  const results: AssessmentCoResult[] = [];

  if (assessment.shape === 'SECTIONED') {
    const sectionIds = (assessment.sections ?? []).map((s) => s.id);
    for (const coId of courseCoIds) {
      const sections: SectionCoTrace[] = [];
      for (const sectionId of sectionIds) {
        const inSection = itemScores.filter((s) => s.sectionId === sectionId && s.appliesToCoIds.includes(coId));
        if (inSection.length === 0) continue; // the CO does not appear in this section
        const levels = inSection.filter((s) => s.level !== null).map((s) => s.level as number);
        sections.push({
          sectionId,
          itemLevels: inSection.map((s) => ({ itemId: s.itemId, level: s.level })),
          level: meanOrNull(levels),
        });
      }
      if (sections.length === 0) continue; // the CO does not appear in this assessment
      const sectionLevels = sections.filter((s) => s.level !== null).map((s) => s.level as number);
      results.push({
        procedureStep: 4,
        assessmentId: assessment.id,
        coId,
        level: meanOrNull(sectionLevels),
        sections,
      });
    }
    return { results, itemScores, warnings };
  }

  // ITEM_LIST and SINGLE_SCORE + RUBRIC: no section layer.
  for (const coId of courseCoIds) {
    const applicable = itemScores.filter((s) => s.appliesToCoIds.includes(coId));
    if (applicable.length === 0) continue;
    const levels = applicable.filter((s) => s.level !== null).map((s) => s.level as number);
    results.push({
      procedureStep: 4,
      assessmentId: assessment.id,
      coId,
      level: meanOrNull(levels),
      items: applicable.map((s) => ({ itemId: s.itemId, level: s.level })),
    });
  }
  return { results, itemScores, warnings };
}
