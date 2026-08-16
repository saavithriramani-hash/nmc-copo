import type ExcelJS from 'exceljs';

/**
 * Cell / reference helpers.
 *
 * THE RULE for this package: every derived number is written as a
 * FORMULA whose cached result is the ENGINE'S value. The formula exists
 * so a reader can see the arithmetic; the engine's number is what the
 * cell shows and what any consumer should trust. Leaf cells (counts,
 * matrix strengths, feedback tallies, parameters) are written as plain
 * literals — those are the inputs the formulas bottom out at.
 */

/** 1-based column index → Excel column letters (1 → A, 27 → AA). */
export function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function address(column: number, row: number, absolute = false): string {
  const col = columnLetter(column);
  return absolute ? `$${col}$${row}` : `${col}${row}`;
}

/** Excel forbids []:*?/\ in sheet names and caps them at 31 characters. */
export function sanitizeSheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  if (base === '') base = 'Sheet';
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    const room = 31 - String(suffix).length - 1;
    candidate = `${base.slice(0, room)} ${suffix}`;
    suffix += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Quotes a sheet name for use in a formula when it is not a bare word. */
export function sheetToken(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** A fully-qualified, absolute reference: `'Internal Test I'!$C$4`. */
export function ref(sheetName: string, column: number, row: number): string {
  return `${sheetToken(sheetName)}!${address(column, row, true)}`;
}

/** A fully-qualified column range: `'Sheet'!$B$5:$B$9`. */
export function colRange(sheetName: string, column: number, fromRow: number, toRow: number): string {
  return `${sheetToken(sheetName)}!${address(column, fromRow, true)}:${address(column, toRow, true)}`;
}

/**
 * Writes a formula whose cached result is the engine's value, so the
 * cell displays the engine's number the moment the file is opened and
 * recalculates visibly when a reader edits an input.
 */
export function setFormula(
  sheet: ExcelJS.Worksheet,
  column: number,
  row: number,
  formula: string,
  engineValue: number | null,
  numFmt?: string,
): string {
  const cell = sheet.getCell(row, column);
  cell.value = { formula, result: engineValue === null ? undefined : engineValue } as ExcelJS.CellFormulaValue;
  if (numFmt) cell.numFmt = numFmt;
  return address(column, row, true);
}

/**
 * The same, for a formula whose result is TEXT — a category name, a
 * label. Separate from `setFormula` so a numeric cell can never be handed
 * a string result by accident: the invariant that levels and scores are
 * numbers, never text, is one of the spreadsheet faults this package
 * exists to correct (§9).
 */
export function setFormulaText(
  sheet: ExcelJS.Worksheet,
  column: number,
  row: number,
  formula: string,
  engineValue: string | null,
): string {
  const cell = sheet.getCell(row, column);
  cell.value = { formula, result: engineValue === null ? undefined : engineValue } as ExcelJS.CellFormulaValue;
  return address(column, row, true);
}

/** Writes a literal input value (a count, a strength, a parameter). */
export function setValue(
  sheet: ExcelJS.Worksheet,
  column: number,
  row: number,
  value: number | string | null,
  numFmt?: string,
): string {
  const cell = sheet.getCell(row, column);
  cell.value = value === null ? null : value;
  if (numFmt) cell.numFmt = numFmt;
  return address(column, row, true);
}

export function setHeader(sheet: ExcelJS.Worksheet, row: number, labels: string[], startColumn = 1): void {
  labels.forEach((label, i) => {
    const cell = sheet.getCell(row, startColumn + i);
    cell.value = label;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
}

export function setTitle(sheet: ExcelJS.Worksheet, row: number, text: string): void {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 12 };
}

export function setNote(sheet: ExcelJS.Worksheet, row: number, text: string): void {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { italic: true, size: 9, color: { argb: 'FF666666' } };
}

export const LEVEL_FMT = '0.000';
export const PCT_FMT = '0.00';
export const MARK_FMT = '0.##';
