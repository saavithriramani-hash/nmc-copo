import type ExcelJS from 'exceljs';
import { LEVEL_FMT, colRange, ref, setFormula, setHeader, setNote, setTitle, setValue } from '../cells';
import type { ExportInput } from '../types';

export interface MatrixRefs {
  /** poId → the weightage cell. */
  weightage: Record<string, string>;
  /** `${coId}:${poId}` → the strength cell (empty when unmapped). */
  strength: Record<string, string>;
}

/**
 * Step 1 — the articulation matrix, with each PO/PSO weightage written as
 * a live AVERAGE over its column. Unmapped cells are left genuinely
 * EMPTY, not zero: Excel's AVERAGE ignores empty cells, which is exactly
 * the engine's "mean of the CO strengths mapped to that PO".
 */
export function buildMatrixSheet(workbook: ExcelJS.Workbook, data: ExportInput, sheetName: string): MatrixRefs {
  const sheet = workbook.addWorksheet(sheetName);
  const cos = data.input.cos;
  const poIds = data.result.step1.perPo.map((entry) => entry.poId);

  sheet.columns = [{ width: 12 }, ...poIds.map(() => ({ width: 10 })), { width: 40 }];

  setTitle(sheet, 1, 'CO – PO/PSO articulation matrix (Step 1)');
  setNote(sheet, 2, 'Correlation strength 1 = low, 2 = medium, 3 = high. A blank cell is unmapped and is excluded from the weightage.');

  const headerRow = 4;
  setHeader(sheet, headerRow, ['CO', ...poIds.map((poId) => data.refs.poCodeById[poId] ?? poId)]);

  const strength: MatrixRefs['strength'] = {};
  const firstDataRow = headerRow + 1;
  cos.forEach((co, index) => {
    const row = firstDataRow + index;
    setValue(sheet, 1, row, data.refs.coCodeById[co.id] ?? co.id);
    poIds.forEach((poId, poIndex) => {
      const value = data.input.poMatrix[co.id]?.[poId] ?? null;
      // Unmapped stays empty — never 0 (§9: absence is not a zero).
      setValue(sheet, 2 + poIndex, row, value);
      strength[`${co.id}:${poId}`] = ref(sheetName, 2 + poIndex, row);
    });
  });

  const lastDataRow = firstDataRow + cos.length - 1;
  const weightageRow = lastDataRow + 1;
  setValue(sheet, 1, weightageRow, 'Weightage');
  sheet.getCell(weightageRow, 1).font = { bold: true };

  const weightage: MatrixRefs['weightage'] = {};
  poIds.forEach((poId, poIndex) => {
    const column = 2 + poIndex;
    const range = colRange(sheetName, column, firstDataRow, lastDataRow);
    const engineValue = data.result.step1.perPo.find((entry) => entry.poId === poId)?.weightage ?? null;
    // Guarded so a PO no CO maps to shows blank, never #DIV/0! and never 0.
    setFormula(sheet, column, weightageRow, `IF(COUNT(${range})=0,"",AVERAGE(${range}))`, engineValue, LEVEL_FMT);
    weightage[poId] = ref(sheetName, column, weightageRow);
  });

  setNote(sheet, weightageRow + 2, 'Weightage = mean of the CO mapping strengths for that PO/PSO. Always derived from this matrix, never stored.');

  return { weightage, strength };
}
