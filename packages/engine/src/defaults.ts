import type { Parameters } from './types';

/**
 * Institution-level default parameters, exactly as confirmed in the
 * requirements (§4.1-§4.5). Programmes and courses may override individual
 * fields via step2ResolveParameters; every applied override must be shown
 * on the course report.
 */
export const DEFAULT_PARAMETERS: Parameters = {
  // §4.1 — attained ⟺ mark ≥ 0.70 × item maximum, uniform across types.
  thresholdFraction: 0.7,

  // §4.2 — proportion of students clearing the threshold → level.
  // The lowerBound-0 row is the table's own "below 40% → 0" row.
  bands: [
    { lowerBound: 80, level: 3 },
    { lowerBound: 60, level: 2 },
    { lowerBound: 40, level: 1 },
    { lowerBound: 0, level: 0 },
  ],

  // §4.3 — end-semester (Step 7) bands, as percentages of the paper
  // maximum so a 100-, 75- or 50-mark paper works unchanged. No row
  // matching → level 0 (the Procedure's "otherwise 0").
  //
  // NOTE (flagged during implementation): on a 75-mark paper the Procedure's
  // integer cut-offs were 45 / 40 / 35. 45/75 = 60% and 40/75 = 53.33% ≥
  // 53.3% reproduce Steps 7's cut-offs, but 35/75 = 46.666…% falls just
  // below the confirmed 46.7% bound, so a student on exactly 35 does not
  // clear the level-1 cut-off under this default. Behaviour is documented
  // by test; changing the default is a change request against §4.3.
  cohortBands: [
    { scorePercent: 60, cohortPercent: 50, level: 3 },
    { scorePercent: 53.3, cohortPercent: 50, level: 2 },
    { scorePercent: 46.7, cohortPercent: 50, level: 1 },
  ],

  // §4.4 — Step 9 weight groups. Quizzes and seminars share the 0.10
  // continuous group with assignments (confirmed decision).
  weightGroups: {
    internal: 0.2,
    continuous: 0.1,
    external: 0.7,
  },

  // §4.4 — Final = 0.9 × Direct + 0.1 × Indirect.
  directWeight: 0.9,
  indirectWeight: 0.1,

  // §4.5 — per-programme target, default 2.5.
  targetAttainment: 2.5,

  // §5.1 — "fewer feedback responses than a configured floor". No default
  // floor is specified anywhere in the requirements or the Procedure, so
  // the shipped default is 0 = disabled; a programme that wants the check
  // sets a positive floor.
  feedbackResponseFloor: 0,
};
