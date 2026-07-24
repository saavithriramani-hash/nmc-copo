import { createHash } from 'node:crypto';
import type { CourseInput, CourseResult, EngineWarning, Parameters } from '@copo/engine';

/**
 * Version-history diffing (FR-16) and the warning-acknowledgement
 * fingerprint, pure and testable.
 */

/**
 * Deterministic fingerprint of a computed result's warnings. The lock
 * form carries it; the lock action recomputes and compares, so an HoD can
 * never acknowledge one set of warnings and lock a different one (marks
 * changed between review and lock → fingerprints differ → re-review).
 */
export function warningsFingerprint(warnings: EngineWarning[]): string {
  const canonical = warnings.map((w) => ({ code: w.code, severity: w.severity, ref: w.ref }));
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export interface ValueChange {
  code: string;
  from: number | null;
  to: number | null;
}

export interface SnapshotDiff {
  finalCoChanges: ValueChange[];
  poOfficialChanges: ValueChange[];
  parameterChanges: { field: string; from: unknown; to: unknown }[];
  assessmentCountChange: { from: number; to: number } | null;
  markCellChange: { from: number; to: number } | null;
  warningCountChange: { from: number; to: number } | null;
  identical: boolean;
}

export interface SnapshotForDiff {
  input: CourseInput;
  result: CourseResult;
  /** id → display code, captured at lock time. */
  coCodeById: Record<string, string>;
  poCodeById: Record<string, string>;
}

const EPSILON = 1e-9;
const differs = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a !== b : Math.abs(a - b) > EPSILON;

/** Counts entered (non-null) mark cells in an input — attempted marks. */
export function countMarkCells(input: CourseInput): number {
  let count = 0;
  for (const assessment of input.assessments) {
    for (const row of Object.values(assessment.marks)) {
      for (const value of Object.values(row)) if (value !== null) count += 1;
    }
  }
  return count;
}

/** What changed from `older` to `newer` — shown on the version history. */
export function diffSnapshots(older: SnapshotForDiff, newer: SnapshotForDiff): SnapshotDiff {
  const finalCoChanges: ValueChange[] = [];
  const oldFinals = new Map(older.result.finalCo.map((co) => [co.coId, co.final]));
  for (const co of newer.result.finalCo) {
    const code = newer.coCodeById[co.coId] ?? co.coId;
    const from = oldFinals.has(co.coId) ? (oldFinals.get(co.coId) ?? null) : null;
    if (differs(from, co.final)) finalCoChanges.push({ code, from, to: co.final });
  }

  const poOfficialChanges: ValueChange[] = [];
  const oldPo = new Map(older.result.po.map((po) => [po.poId, po.official]));
  for (const po of newer.result.po) {
    const code = newer.poCodeById[po.poId] ?? po.poId;
    const from = oldPo.has(po.poId) ? (oldPo.get(po.poId) ?? null) : null;
    if (differs(from, po.official)) poOfficialChanges.push({ code, from, to: po.official });
  }

  const parameterChanges: SnapshotDiff['parameterChanges'] = [];
  const fields = Object.keys({ ...older.result.parameters, ...newer.result.parameters }) as (keyof Parameters)[];
  for (const field of fields) {
    const from = older.result.parameters[field];
    const to = newer.result.parameters[field];
    if (JSON.stringify(from) !== JSON.stringify(to)) parameterChanges.push({ field, from, to });
  }

  const oldAssessments = older.input.assessments.length;
  const newAssessments = newer.input.assessments.length;
  const oldCells = countMarkCells(older.input);
  const newCells = countMarkCells(newer.input);
  const oldWarnings = older.result.warnings.length;
  const newWarnings = newer.result.warnings.length;

  const diff: SnapshotDiff = {
    finalCoChanges,
    poOfficialChanges,
    parameterChanges,
    assessmentCountChange: oldAssessments === newAssessments ? null : { from: oldAssessments, to: newAssessments },
    markCellChange: oldCells === newCells ? null : { from: oldCells, to: newCells },
    warningCountChange: oldWarnings === newWarnings ? null : { from: oldWarnings, to: newWarnings },
    identical: false,
  };
  diff.identical =
    diff.finalCoChanges.length === 0 &&
    diff.poOfficialChanges.length === 0 &&
    diff.parameterChanges.length === 0 &&
    diff.assessmentCountChange === null &&
    diff.markCellChange === null &&
    diff.warningCountChange === null;
  return diff;
}
