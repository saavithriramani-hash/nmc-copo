import type { EngineWarning, IndirectCounts, IndirectResult } from '../types';
import { makeWarning } from '../util';

/**
 * Procedure Step 8 — indirect attainment from 3-point CO-wise feedback.
 *
 * indirect(CO) = (1·n1 + 2·n2 + 3·n3) ÷ N, N = n1 + n2 + n3.
 *
 * Degenerate cases (§5.1):
 * - No feedback anywhere → one NO_INDIRECT_DATA warning; every value null;
 *   Step 9 computes direct-only, flagged.
 * - A CO with zero responses while others have feedback → NO_FEEDBACK_FOR_CO;
 *   that CO's value is null (never a divide-by-zero, never a zero).
 * - 0 < N < feedbackResponseFloor → the value is still computed but carries
 *   a FEEDBACK_BELOW_FLOOR warning. A floor of 0 disables the check.
 */
export function step8IndirectAttainment(
  courseCoIds: string[],
  indirect: Record<string, IndirectCounts>,
  feedbackResponseFloor: number,
): { results: IndirectResult[]; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = [];

  const countsFor = (coId: string): IndirectCounts => indirect[coId] ?? { n1: 0, n2: 0, n3: 0 };
  const courseHasFeedback = courseCoIds.some((coId) => {
    const c = countsFor(coId);
    return c.n1 + c.n2 + c.n3 > 0;
  });

  if (!courseHasFeedback) {
    warnings.push(
      makeWarning(
        'NO_INDIRECT_DATA',
        'warning',
        'No indirect feedback for any CO; final attainment is computed from direct values only.',
        {},
      ),
    );
    return {
      results: courseCoIds.map((coId) => ({ procedureStep: 8, coId, n1: 0, n2: 0, n3: 0, responses: 0, value: null })),
      warnings,
    };
  }

  const results: IndirectResult[] = courseCoIds.map((coId) => {
    const { n1, n2, n3 } = countsFor(coId);
    const responses = n1 + n2 + n3;
    if (responses === 0) {
      warnings.push(
        makeWarning(
          'NO_FEEDBACK_FOR_CO',
          'warning',
          `No feedback responses for '${coId}'; its final attainment is computed from direct values only.`,
          { coId },
        ),
      );
      return { procedureStep: 8 as const, coId, n1, n2, n3, responses, value: null };
    }
    if (feedbackResponseFloor > 0 && responses < feedbackResponseFloor) {
      warnings.push(
        makeWarning(
          'FEEDBACK_BELOW_FLOOR',
          'warning',
          `'${coId}' has ${responses} feedback response(s), below the configured floor of ${feedbackResponseFloor}; the indirect value may be unreliable.`,
          { coId },
        ),
      );
    }
    return {
      procedureStep: 8 as const,
      coId,
      n1,
      n2,
      n3,
      responses,
      value: (1 * n1 + 2 * n2 + 3 * n3) / responses,
    };
  });

  return { results, warnings };
}
