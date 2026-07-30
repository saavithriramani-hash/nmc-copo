/**
 * Gap analysis (§4.5) — pure, unit-tested.
 *
 * Every CO below the programme's target is flagged with the size of the
 * shortfall, and the report prints a blank action-plan stub beside it for
 * the faculty to complete by hand or in a later revision. A CO with no
 * attainment value is reported separately: it is not "below target", it
 * is unmeasured, and the two must never be conflated.
 */

export interface CoAttainmentRow {
  code: string;
  statement: string;
  final: number | null;
}

export interface GapRow {
  code: string;
  statement: string;
  achieved: number;
  target: number;
  /** target − achieved, always > 0 for rows in `below`. */
  gap: number;
}

export interface GapAnalysis {
  target: number;
  /** COs that met or exceeded the target. */
  met: { code: string; achieved: number }[];
  /** COs below target, worst shortfall first. */
  below: GapRow[];
  /** COs with no computable attainment — flagged, never counted as 0. */
  unmeasured: { code: string; statement: string }[];
  /** Mean of the COs that have a value; null when none do. */
  meanAchieved: number | null;
}

const EPSILON = 1e-9;

export function analyseGaps(cos: CoAttainmentRow[], target: number): GapAnalysis {
  const met: GapAnalysis['met'] = [];
  const below: GapRow[] = [];
  const unmeasured: GapAnalysis['unmeasured'] = [];
  const values: number[] = [];

  for (const co of cos) {
    if (co.final === null) {
      unmeasured.push({ code: co.code, statement: co.statement });
      continue;
    }
    values.push(co.final);
    if (co.final < target - EPSILON) {
      below.push({ code: co.code, statement: co.statement, achieved: co.final, target, gap: target - co.final });
    } else {
      met.push({ code: co.code, achieved: co.final });
    }
  }

  below.sort((a, b) => b.gap - a.gap || a.code.localeCompare(b.code));

  return {
    target,
    met,
    below,
    unmeasured,
    meanAchieved: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}
