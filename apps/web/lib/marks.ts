/**
 * Shared mark-cell semantics and the pure mark-import planner (FR-12).
 * Kept dependency-free and testable. The whole system's blank ≠ zero rule
 * lives here in one place: an empty cell is "did not attempt" (null); "0"
 * is a real attempted mark.
 */

export type CellParse =
  | { kind: 'blank' } // did not attempt
  | { kind: 'value'; value: number }
  | { kind: 'invalid'; reason: string };

/** Parses a raw cell string against an item maximum. Empty = blank, not 0. */
export function parseMarkCell(raw: string, maxMark: number): CellParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'blank' };
  // Reject anything that is not a plain decimal number.
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { kind: 'invalid', reason: 'not a number' };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { kind: 'invalid', reason: 'not a number' };
  if (value > maxMark) return { kind: 'invalid', reason: `over the maximum of ${maxMark}` };
  return { kind: 'value', value };
}

/** Canonical form for comparing two mark values (null = blank). */
export function marksEqual(a: number | null, b: number | null): boolean {
  return a === b;
}

// ── mark import (paste / upload for one assessment) ─────────────────────

export interface ImportItem {
  id: string;
  label: string;
  maxMark: number;
}
export interface ImportEnrolment {
  enrolmentId: string;
  registerNumber: string;
  studentName: string;
}

export interface MarkChange {
  enrolmentId: string;
  itemId: string;
  registerNumber: string;
  studentName: string;
  itemLabel: string;
  oldValue: number | null;
  newValue: number | null;
}
export interface MarkImportInvalid {
  registerNumber: string;
  itemLabel: string;
  raw: string;
  reason: string;
}

export interface MarkImportPlan {
  changes: MarkChange[];
  /** Cells that parsed but were identical to the stored value. */
  unchanged: number;
  /** Register numbers in the file that match no enrolment in this course. */
  unmatchedRegisterNumbers: string[];
  /** Header columns that match no item label in this assessment. */
  unknownColumns: string[];
  /** Item columns present in the assessment but absent from the file. */
  missingColumns: string[];
  invalid: MarkImportInvalid[];
}

const REG_HEADER = /^(reg(ister)?|roll|enroll?ment)\.?\s*(no\.?|number|num)?$/i;
/**
 * A name column identifies the student; it is not an item, so it is
 * skipped rather than reported as an unknown column. The downloadable
 * template carries one so faculty can see who they are marking, and a
 * spreadsheet exported from anywhere else usually does too.
 */
const NAME_HEADER = /^(student(\s*name)?|name|full\s*name)$/i;
const norm = (value: string): string => value.trim().toLowerCase();

/**
 * Plans a spreadsheet import for ONE assessment, matched on register
 * number (rows) and item label (columns). Produces the full change list —
 * old value → new value for every cell that differs — so the UI can show
 * every change before a single row is written. Empty cells import as blank
 * (surfaced in the preview like any other change), honouring blank ≠ zero.
 *
 * `existing` maps `${enrolmentId}:${itemId}` → current value (null = blank).
 */
export function planMarkImport(args: {
  rows: string[][];
  items: ImportItem[];
  enrolments: ImportEnrolment[];
  existing: Map<string, number | null>;
}): MarkImportPlan {
  const { rows, items, enrolments, existing } = args;
  const plan: MarkImportPlan = {
    changes: [],
    unchanged: 0,
    unmatchedRegisterNumbers: [],
    unknownColumns: [],
    missingColumns: [],
    invalid: [],
  };
  if (rows.length < 2) return plan; // need a header plus at least one data row

  const header = rows[0]!;
  const itemByLabel = new Map(items.map((item) => [norm(item.label), item]));
  const enrolByReg = new Map(enrolments.map((enrolment) => [enrolment.registerNumber, enrolment]));

  // Column → item mapping. The register-number column is skipped; every
  // other header must match an item label or it is reported.
  let regCol = header.findIndex((cell) => REG_HEADER.test(cell.trim()));
  if (regCol === -1) regCol = 0; // fall back to the first column
  const columnItems: (ImportItem | null)[] = header.map((cell, index) => {
    if (index === regCol) return null;
    if (cell.trim() === '') return null;
    if (NAME_HEADER.test(cell.trim())) return null; // identifying, not an item
    const item = itemByLabel.get(norm(cell));
    if (!item) plan.unknownColumns.push(cell.trim());
    return item ?? null;
  });

  const matchedItemIds = new Set(columnItems.filter((item): item is ImportItem => item !== null).map((item) => item.id));
  for (const item of items) {
    if (!matchedItemIds.has(item.id)) plan.missingColumns.push(item.label);
  }

  const seenUnmatched = new Set<string>();
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]!;
    const registerNumber = (cells[regCol] ?? '').trim();
    if (registerNumber === '') continue;
    const enrolment = enrolByReg.get(registerNumber);
    if (!enrolment) {
      if (!seenUnmatched.has(registerNumber)) {
        seenUnmatched.add(registerNumber);
        plan.unmatchedRegisterNumbers.push(registerNumber);
      }
      continue;
    }

    for (let c = 0; c < columnItems.length; c += 1) {
      const item = columnItems[c];
      if (!item) continue;
      const raw = cells[c] ?? '';
      const parsed = parseMarkCell(raw, item.maxMark);
      if (parsed.kind === 'invalid') {
        plan.invalid.push({ registerNumber, itemLabel: item.label, raw: raw.trim(), reason: parsed.reason });
        continue;
      }
      const newValue = parsed.kind === 'blank' ? null : parsed.value;
      const oldValue = existing.get(`${enrolment.enrolmentId}:${item.id}`) ?? null;
      if (marksEqual(oldValue, newValue)) {
        plan.unchanged += 1;
        continue;
      }
      plan.changes.push({
        enrolmentId: enrolment.enrolmentId,
        itemId: item.id,
        registerNumber,
        studentName: enrolment.studentName,
        itemLabel: item.label,
        oldValue,
        newValue,
      });
    }
  }

  return plan;
}
