import { EngineAssertionError } from '../errors';
import type { EngineWarning, FinalCoAttainment, GroupCoLevel, GroupTerm, IndirectResult, Parameters } from '../types';
import { makeWarning } from '../util';

/**
 * Tolerance for the below-target flag only. Final values are sums of
 * products of small decimals whose accumulated float error is a few ulps
 * (~1e-15); real data never lands within 1e-9 of the target without being
 * exactly on it, so this prevents a false "below target" from binary
 * rounding while changing no genuine comparison. Attainment arithmetic
 * itself uses no tolerances.
 */
const BELOW_TARGET_EPSILON = 1e-9;

/**
 * Procedure Step 9 — final CO attainment.
 *
 * direct(CO) = Σ_groups weight(group) × level(group, CO)
 * final(CO)  = directWeight × direct(CO) + indirectWeight × indirect(CO)
 *
 * With the default configuration this is exactly the Procedure's
 * 0.2×Internal + 0.1×Assignment + 0.7×External; the internal figure enters
 * at full value with no intermediate averaging (§9 fault list).
 *
 * Missing pieces are never zero-filled (§9):
 * - A declared group with no assessments: its weight redistributes
 *   proportionally across the remaining groups, and the report says so
 *   (EMPTY_WEIGHT_GROUP, §5.1).
 * - A non-empty group with no value for a specific CO: the same
 *   proportional renormalisation, per CO, over the groups that did assess
 *   it (GROUP_NOT_ASSESSING_CO). This mirrors the Procedure's own Step 5
 *   rule — a CO assessed in one test carries that test's value — applied
 *   at group level. Multiplying a missing level by its weight would
 *   silently depress the CO, which is the exact spreadsheet fault this
 *   engine exists to prevent.
 * - No indirect value: final = direct, flagged upstream (§5.1
 *   "direct-only"); the missing 0.1 share is not filled with zero.
 * - No group assessed the CO at all: direct and final stay null
 *   (CO_NOT_ASSESSED was already raised in Step 5).
 */
export function step9FinalCoAttainment(
  courseCoIds: string[],
  parameters: Parameters,
  groupsWithAssessments: string[],
  groupCo: GroupCoLevel[],
  indirectResults: IndirectResult[],
): { results: FinalCoAttainment[]; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = [];
  const { weightGroups, directWeight, indirectWeight, targetAttainment } = parameters;
  const declaredGroupIds = Object.keys(weightGroups);
  const nonEmpty = new Set(groupsWithAssessments);

  for (const groupId of declaredGroupIds) {
    if (!nonEmpty.has(groupId)) {
      warnings.push(
        makeWarning(
          'EMPTY_WEIGHT_GROUP',
          'warning',
          `Weight group '${groupId}' (weight ${weightGroups[groupId]}) has no assessments; its weight is redistributed proportionally across the remaining groups.`,
          { groupId },
        ),
      );
    }
  }

  const indirectByCo = new Map(indirectResults.map((r) => [r.coId, r.value]));

  const results: FinalCoAttainment[] = courseCoIds.map((coId) => {
    const rows = groupCo.filter((r) => r.coId === coId);

    // Per-CO gaps in otherwise non-empty groups (skip if the CO is assessed
    // nowhere — CO_NOT_ASSESSED already covers that).
    if (rows.length > 0) {
      for (const groupId of declaredGroupIds) {
        if (nonEmpty.has(groupId) && !rows.some((r) => r.groupId === groupId)) {
          warnings.push(
            makeWarning(
              'GROUP_NOT_ASSESSING_CO',
              'warning',
              `Group '${groupId}' has assessments but none produced a level for '${coId}'; the group weights for this CO are renormalised over the groups that assessed it.`,
              { groupId, coId },
            ),
          );
        }
      }
    }

    const base = {
      procedureStep: 9 as const,
      coId,
      directWeight,
      indirectWeight,
      targetAttainment,
    };

    const indirect = indirectByCo.get(coId) ?? null;

    if (rows.length === 0) {
      return { ...base, groupTerms: [], direct: null, indirect, directOnly: false, final: null, belowTarget: null };
    }

    let weightSum = 0;
    for (const row of rows) {
      const w = weightGroups[row.groupId];
      if (w === undefined) throw new EngineAssertionError(`group '${row.groupId}' missing from weightGroups despite validation`);
      weightSum += w;
    }

    const groupTerms: GroupTerm[] = rows.map((row) => {
      const declared = weightGroups[row.groupId] as number; // validated > 0 above
      return { groupId: row.groupId, declaredWeight: declared, weightUsed: declared / weightSum, level: row.level };
    });

    let direct = 0;
    for (const term of groupTerms) direct += term.weightUsed * term.level;

    const directOnly = indirect === null;
    const final = directOnly ? direct : directWeight * direct + indirectWeight * indirect;
    const belowTarget = final < targetAttainment - BELOW_TARGET_EPSILON;

    return { ...base, groupTerms, direct, indirect, directOnly, final, belowTarget };
  });

  return { results, warnings };
}
