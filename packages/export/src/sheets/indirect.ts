import type ExcelJS from 'exceljs';
import { LEVEL_FMT, ref, setFormula, setHeader, setNote, setTitle, setValue } from '../cells';
import type { ExportInput } from '../types';

export interface IndirectRefs {
  /** coId → the indirect value cell (blank when there is no feedback). */
  value: Record<string, string>;
  hasFeedback: Record<string, boolean>;
}

/** Step 8 — indirect attainment from the 3-point CO-wise feedback. */
export function buildIndirectSheet(workbook: ExcelJS.Workbook, data: ExportInput, sheetName: string): IndirectRefs {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [{ width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 44 }];

  setTitle(sheet, 1, 'Indirect attainment (Step 8)');
  setNote(sheet, 2, 'Indirect = (1×n₁ + 2×n₂ + 3×n₃) ÷ N, from the 3-point CO-wise student feedback.');

  const headerRow = 4;
  setHeader(sheet, headerRow, ['CO', 'n₁ (rated 1)', 'n₂ (rated 2)', 'n₃ (rated 3)', 'N (responses)', 'Indirect', 'Note']);

  const value: IndirectRefs['value'] = {};
  const hasFeedback: IndirectRefs['hasFeedback'] = {};

  data.input.cos.forEach((co, index) => {
    const row = headerRow + 1 + index;
    const engine = data.result.indirect.find((r) => r.coId === co.id);
    setValue(sheet, 1, row, data.refs.coCodeById[co.id] ?? co.id);
    const n1 = setValue(sheet, 2, row, engine?.n1 ?? 0);
    const n2 = setValue(sheet, 3, row, engine?.n2 ?? 0);
    const n3 = setValue(sheet, 4, row, engine?.n3 ?? 0);
    const n = setFormula(sheet, 5, row, `SUM(${n1},${n2},${n3})`, engine?.responses ?? 0);
    setFormula(
      sheet,
      6,
      row,
      `IF(${n}=0,"",(1*${n1}+2*${n2}+3*${n3})/${n})`,
      engine?.value ?? null,
      LEVEL_FMT,
    );
    if ((engine?.responses ?? 0) === 0) {
      setValue(sheet, 7, row, 'No feedback — this CO is computed direct-only and flagged.');
    }
    value[co.id] = ref(sheetName, 6, row);
    hasFeedback[co.id] = (engine?.value ?? null) !== null;
  });

  return { value, hasFeedback };
}
