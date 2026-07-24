/**
 * Domain types for the CO-PO attainment engine.
 *
 * Design rules enforced here (see CLAUDE.md and requirements §5, §9):
 * - Attainment levels are the integer literals 0 | 1 | 2 | 3, never strings.
 * - A blank mark is `null` ("did not attempt", excluded from denominators).
 *   Zero is a real mark ("attempted, scored nothing", included). `undefined`
 *   and `NaN` are rejected by validation; they never stand in for blank.
 * - Where a value cannot be computed (no attempts, no mapping, no feedback)
 *   the result is `null` plus a structured warning — never a silent zero.
 */

/** An attainment level as defined by the Procedure. Integer, never a string. */
export type Level = 0 | 1 | 2 | 3;

/** CO→PO/PSO correlation strength (Procedure Step 1): 1 low, 2 medium, 3 high. */
export type MappingStrength = 1 | 2 | 3;

export interface CO {
  id: string;
  statement: string;
  /** Bloom's taxonomy level, display-only; the engine does not use it. */
  bloomLevel: string;
}

/**
 * Articulation matrix. Outer key: CO id. Inner key: PO/PSO id.
 * `null` = unmapped. The union of inner keys defines the PO/PSO set.
 */
export type PoMatrix = Record<string, Record<string, MappingStrength | null>>;

/** One row of the rubric band table (§4.2): pct of students ≥ lowerBound → level. */
export interface BandRow {
  /** Inclusive lower bound, in percent of students clearing the threshold. */
  lowerBound: number;
  level: Level;
}

/** One row of the end-semester cohort band table (§4.3, Procedure Step 7). */
export interface CohortBandRow {
  /** Score cut-off as a percent of the paper maximum (e.g. 60 = 60%). */
  scorePercent: number;
  /** Percent of attempting students who must reach the cut-off (e.g. 50). */
  cohortPercent: number;
  level: Level;
}

/**
 * Attainment parameters (§4). Resolved institution → programme → course
 * before reaching the engine; see step2ResolveParameters.
 */
export interface Parameters {
  /** Item threshold as a fraction of the item maximum (§4.1). Default 0.70. */
  thresholdFraction: number;
  /** Rubric band table (§4.2). Must contain a lowerBound-0 row. */
  bands: BandRow[];
  /** End-semester cohort band table (§4.3). No match → level 0. */
  cohortBands: CohortBandRow[];
  /** Weight per group id (§4.4). Each > 0; must sum to 1.00. */
  weightGroups: Record<string, number>;
  /** Direct share of the final blend (§4.4). Default 0.9. */
  directWeight: number;
  /** Indirect share of the final blend (§4.4). Default 0.1. */
  indirectWeight: number;
  /** Per-programme CO target (§4.5). Default 2.5. */
  targetAttainment: number;
  /**
   * Minimum indirect-feedback responses per CO before the value is
   * considered reliable (§5.1). 0 disables the floor check. Responses
   * below a non-zero floor still compute, with a warning.
   */
  feedbackResponseFloor: number;
}

export type Shape = 'SECTIONED' | 'ITEM_LIST' | 'SINGLE_SCORE';
export type ScoringRule = 'RUBRIC' | 'COHORT_BAND';

/** A question / mark-bearing item. */
export interface Item {
  id: string;
  /** Maximum obtainable mark. Must be > 0. */
  maxMark: number;
  /** CO this item assesses; `null` = untagged → applies to every CO (§3.1). */
  coTag: string | null;
}

/**
 * A user-named section of a SECTIONED assessment. Items live inside their
 * section, so an item cannot reference a section that does not exist.
 */
export interface Section {
  id: string;
  name: string;
  items: Item[];
}

/**
 * Marks: enrolmentId → itemId → mark.
 * `null` = did not attempt. A missing itemId key is treated as `null`.
 * For SINGLE_SCORE assessments the single item's key is the assessment id.
 */
export type MarkRecord = Record<string, Record<string, number | null>>;

export interface Assessment {
  id: string;
  name: string;
  shape: Shape;
  /** COHORT_BAND is only defined for SINGLE_SCORE (§3.1); validated. */
  scoringRule: ScoringRule;
  /** Key into Parameters.weightGroups. */
  weightGroup: string;
  /** SECTIONED only. */
  sections?: Section[];
  /** ITEM_LIST only. */
  items?: Item[];
  /** SINGLE_SCORE only. */
  maxMark?: number;
  /**
   * SINGLE_SCORE only (other shapes tag per item). Absent or empty =
   * applies to every CO, as the end-semester assessment is (§3.1).
   */
  coTags?: string[];
  marks: MarkRecord;
}

/** 3-point indirect feedback counts for one CO (Procedure Step 8). */
export interface IndirectCounts {
  n1: number;
  n2: number;
  n3: number;
}

export interface CourseInput {
  cos: CO[];
  poMatrix: PoMatrix;
  parameters: Parameters;
  assessments: Assessment[];
  /** CO id → feedback counts. A missing CO key = no feedback for that CO. */
  indirect: Record<string, IndirectCounts>;
}

// ---------------------------------------------------------------------------
// Warnings — structured, never bare strings (§5.1).
// ---------------------------------------------------------------------------

export type WarningCode =
  | 'CO_NOT_ASSESSED'          // §5.1: a CO with no attainment value in any assessment
  | 'ITEM_NO_ATTEMPTS'         // §5.1: an item (or single score) nobody attempted
  | 'EMPTY_WEIGHT_GROUP'       // §5.1: a declared weight group with no assessments
  | 'GROUP_NOT_ASSESSING_CO'   // a non-empty group with no value for a CO (weight renormalised)
  | 'ASSESSMENT_UNTAGGED'      // §5.1: no CO tags anywhere → contributes to every CO
  | 'FEEDBACK_BELOW_FLOOR'     // §5.1: fewer responses than the configured floor
  | 'NO_FEEDBACK_FOR_CO'       // zero responses for one CO while the course has feedback
  | 'NO_INDIRECT_DATA'         // §5.1: no feedback at all → direct-only course
  | 'PO_UNMAPPED'              // no CO maps to this PO/PSO
  | 'NO_ASSESSED_COS';         // no CO has a final value; PO projection impossible

/** Identifies the entity a warning refers to. Only the relevant ids are set. */
export interface WarningRef {
  coId?: string;
  poId?: string;
  assessmentId?: string;
  sectionId?: string;
  itemId?: string;
  groupId?: string;
}

export interface EngineWarning {
  code: WarningCode;
  severity: 'info' | 'warning';
  message: string;
  ref: WarningRef;
}

// ---------------------------------------------------------------------------
// Step results. Every result carries the inputs that produced it, so the UI
// can drill from any PO figure down to a single item (FR-14/FR-15). Raw mark
// matrices are NOT copied into results; ids reference them instead.
// ---------------------------------------------------------------------------

/** Step 1 output for one PO/PSO. */
export interface PoWeightage {
  poId: string;
  /** Mean of mapped CO strengths; null if no CO maps to this PO. */
  weightage: number | null;
  /** The mapped strengths that produced the mean. */
  strengths: { coId: string; strength: MappingStrength }[];
}

export interface Step1Result {
  procedureStep: 1;
  perPo: PoWeightage[];
}

/** Where each resolved parameter field came from (Step 2; §4, FR-3). */
export type ParameterSource = 'institution' | 'programme' | 'course';

export interface Step2Result {
  procedureStep: 2;
  parameters: Parameters;
  provenance: Record<keyof Parameters, ParameterSource>;
}

/** Step 3 output for one rubric-scored item. */
export interface ItemScore {
  procedureStep: 3;
  assessmentId: string;
  /** Section containing the item; null for ITEM_LIST / SINGLE_SCORE. */
  sectionId: string | null;
  /** For SINGLE_SCORE the pseudo-item id equals the assessment id. */
  itemId: string;
  maxMark: number;
  thresholdFraction: number;
  /**
   * thresholdFraction × maxMark, for display only. Clearing decisions use
   * an exact ratio comparison (see compare.ts), never this product.
   */
  thresholdMark: number;
  /** COs this item's level applies to (untagged resolved to all COs). */
  appliesToCoIds: string[];
  /** Students with a non-null mark. */
  attempted: number;
  /** Students with mark ≥ threshold. cleared ⊆ attempted. */
  cleared: number;
  /** cleared/attempted × 100; null when attempted = 0. Asserted ∈ [0,100]. */
  pct: number | null;
  /** The band row that matched; null when attempted = 0. */
  matchedBand: BandRow | null;
  /** Integer level 0-3; null when attempted = 0. */
  level: Level | null;
}

/** Cohort-band scoring detail for a SINGLE_SCORE + COHORT_BAND assessment. */
export interface CohortBandStat {
  scorePercent: number;
  cohortPercent: number;
  level: Level;
  /** Students (of attempted) whose score ≥ scorePercent of the maximum. */
  studentsAtOrAbove: number;
  /** studentsAtOrAbove / attempted × 100. Asserted ∈ [0,100]. */
  pctOfStudents: number;
  passed: boolean;
}

export interface CohortScore {
  attempted: number;
  maxMark: number;
  /** Stats per band row, evaluated in descending level order. */
  bands: CohortBandStat[];
  /** First band row (highest level) whose cohort test passed; null = none. */
  matched: CohortBandRow | null;
  /**
   * Level from the matched row, or 0 when no row passed (§4.3 "else 0").
   * `null` only when nobody attempted — never coerced to 0 (§5.1).
   */
  level: Level | null;
}

/** Step 4 trace: how one section contributed to one CO. */
export interface SectionCoTrace {
  sectionId: string;
  itemLevels: { itemId: string; level: Level | null }[];
  /** Mean of non-null item levels; null if every item level is null. */
  level: number | null;
}

/**
 * Step 4 output: one assessment's level for one CO. A row exists only where
 * the CO appears in the assessment (tagged, or untagged-applies-to-all).
 */
export interface AssessmentCoResult {
  procedureStep: 4;
  assessmentId: string;
  coId: string;
  /** Mean level; null only when nothing contributing was attempted. */
  level: number | null;
  /** SECTIONED trace: the sections in which this CO appears. */
  sections?: SectionCoTrace[];
  /** ITEM_LIST / SINGLE_SCORE+RUBRIC trace: contributing item levels. */
  items?: { itemId: string; level: Level | null }[];
  /** SINGLE_SCORE+COHORT_BAND trace. */
  cohort?: CohortScore;
}

/**
 * Step 5 output (Steps 6 and 7 are this same consolidation applied to the
 * continuous and external groups — §5): one group's level for one CO.
 * A row exists only where at least one assessment in the group produced a
 * non-null level for the CO, so `level` is always a number.
 */
export interface GroupCoLevel {
  procedureStep: 5;
  groupId: string;
  coId: string;
  /** Mean across the group's assessments in which the CO appears. */
  level: number;
  contributions: { assessmentId: string; level: number }[];
}

/** Step 8 output for one CO. */
export interface IndirectResult {
  procedureStep: 8;
  coId: string;
  n1: number;
  n2: number;
  n3: number;
  responses: number;
  /** (1·n1 + 2·n2 + 3·n3) / N; null when N = 0. */
  value: number | null;
}

/** Step 9 trace: one weight-group term of a CO's direct value. */
export interface GroupTerm {
  groupId: string;
  /** Weight as declared in Parameters.weightGroups. */
  declaredWeight: number;
  /**
   * Weight actually applied after renormalising over the groups that
   * assessed this CO (§5.1 redistribution). Equals declaredWeight when
   * every group assessed the CO.
   */
  weightUsed: number;
  level: number;
}

export interface FinalCoAttainment {
  procedureStep: 9;
  coId: string;
  groupTerms: GroupTerm[];
  /** Σ weightUsed × level; null when no group assessed the CO. */
  direct: number | null;
  /** From Step 8; null when there is no feedback. */
  indirect: number | null;
  directWeight: number;
  indirectWeight: number;
  /** True when indirect was missing and final = direct (flagged upstream). */
  directOnly: boolean;
  /** directWeight × direct + indirectWeight × indirect; direct when directOnly. */
  final: number | null;
  targetAttainment: number;
  /** final < target (§4.5); null when final is null. */
  belowTarget: boolean | null;
}

/** Step 10 output for one PO/PSO. */
export interface PoAttainment {
  procedureStep: 10;
  poId: string;
  weightage: number | null;
  /** Mean of final CO attainment over COs with a value — same for every PO. */
  meanFinalCo: number | null;
  /** The COs whose finals entered the mean. */
  contributingCoIds: string[];
  /** Official figure (Procedure Step 10): weightage × meanFinalCo / 3. */
  official: number | null;
  /** Secondary comparison column: Σ(strength × final) / Σ(strength). */
  secondary: number | null;
  secondaryTerms: { coId: string; strength: MappingStrength; final: number }[];
}

/** The full attainment chain for one course. */
export interface CourseResult {
  /** Parameters used, echoed for the report (§4: overrides must be visible). */
  parameters: Parameters;
  step1: Step1Result;
  /** Per rubric item (Step 3). */
  itemScores: ItemScore[];
  /** Per assessment per CO (Step 4). */
  assessmentCo: AssessmentCoResult[];
  /** Per weight group per CO (Steps 5-7). */
  groupCo: GroupCoLevel[];
  /** Per CO (Step 8). */
  indirect: IndirectResult[];
  /** Per CO (Step 9). */
  finalCo: FinalCoAttainment[];
  /** Per PO/PSO (Step 10). */
  po: PoAttainment[];
  /** All warnings, in procedure-step order. Never silently empty on gaps. */
  warnings: EngineWarning[];
}
