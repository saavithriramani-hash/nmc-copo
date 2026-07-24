import type { Assessment, AssessmentCoResult, EngineWarning, GroupCoLevel } from '../types';
import { makeWarning } from '../util';

/**
 * Procedure Step 5 — consolidate within each weight group. Steps 6 and 7
 * are this same consolidation applied to the continuous and external
 * groups (§5, "Steps 6 & 7 fall out of Step 5").
 *
 * level(group, CO) = mean of level(assessment, CO) across the assessments
 * in that group in which the CO appears. A CO assessed in one internal test
 * carries that test's value; a CO in three carries their mean — the
 * Procedure's two-test rule generalised to any number, so nothing here
 * assumes a course has exactly two internal tests.
 *
 * A row is emitted only where at least one assessment produced a non-null
 * level for the CO. A CO with no value in any group gets a CO_NOT_ASSESSED
 * warning (§5.1); its downstream values stay null, never zero.
 */
export function step5GroupCoLevels(
  weightGroups: Record<string, number>,
  assessments: Assessment[],
  assessmentCo: AssessmentCoResult[],
  courseCoIds: string[],
): { results: GroupCoLevel[]; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = [];
  const groupOf = new Map<string, string>(assessments.map((a) => [a.id, a.weightGroup]));

  const results: GroupCoLevel[] = [];
  for (const groupId of Object.keys(weightGroups)) {
    for (const coId of courseCoIds) {
      const contributions = assessmentCo
        .filter((r) => r.coId === coId && r.level !== null && groupOf.get(r.assessmentId) === groupId)
        .map((r) => ({ assessmentId: r.assessmentId, level: r.level as number }));
      if (contributions.length === 0) continue;
      let sum = 0;
      for (const c of contributions) sum += c.level;
      results.push({
        procedureStep: 5,
        groupId,
        coId,
        level: sum / contributions.length,
        contributions,
      });
    }
  }

  for (const coId of courseCoIds) {
    if (!results.some((r) => r.coId === coId)) {
      warnings.push(
        makeWarning(
          'CO_NOT_ASSESSED',
          'warning',
          `'${coId}' has no attainment value in any assessment; its direct, final and PO contributions cannot be computed.`,
          { coId },
        ),
      );
    }
  }

  return { results, warnings };
}
