import type ExcelJS from 'exceljs';
import { LEVEL_FMT, colRange, ref, setFormula, setHeader, setNote, setTitle, setValue } from '../cells';
import type { FinalCoRefs } from './finalCo';
import type { MatrixRefs } from './matrix';
import type { ExportInput } from '../types';

/**
 * Step 10 — PO/PSO attainment.
 *
 * The official figure is the Procedure's: weightage × (mean final CO
 * attainment) ÷ 3. The CO-weighted alternative is written alongside as a
 * clearly-labelled comparison column, never as the reported figure.
 */
export interface PoRefs {
  official: Record<string, string>;
  secondary: Record<string, string>;
  meanFinal: Record<string, string>;
  weightage: Record<string, string>;
}

export function buildPoSheet(
  workbook: ExcelJS.Workbook,
  data: ExportInput,
  matrix: MatrixRefs,
  finalCo: FinalCoRefs,
  sheetName: string,
): PoRefs {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [{ width: 12 }, { width: 12 }, { width: 18 }, { width: 14 }, { width: 22 }, { width: 46 }];

  setTitle(sheet, 1, 'PO / PSO attainment (Step 10)');
  setNote(sheet, 2, 'Official = weightage × (mean final CO attainment) ÷ 3 — the Procedure’s method and the reported figure.');

  const headerRow = 4;
  setHeader(sheet, headerRow, [
    'PO / PSO',
    'Weightage',
    'Mean final CO',
    'Official',
    'Secondary (comparison)',
    'Note',
  ]);

  const finalRange = colRange(finalCo.sheetName, finalCo.finalColumn.column, finalCo.finalColumn.firstRow, finalCo.finalColumn.lastRow);
  const refs: PoRefs = { official: {}, secondary: {}, meanFinal: {}, weightage: {} };

  data.result.po.forEach((po, index) => {
    const row = headerRow + 1 + index;
    setValue(sheet, 1, row, data.refs.poCodeById[po.poId] ?? po.poId);

    const weightageCell = setFormula(sheet, 2, row, matrix.weightage[po.poId]!, po.weightage, LEVEL_FMT);

    // Mean over the COs that produced a final value; blank finals are
    // ignored by AVERAGE, exactly as the engine excludes them.
    const meanCell = setFormula(
      sheet,
      3,
      row,
      `IF(COUNT(${finalRange})=0,"",AVERAGE(${finalRange}))`,
      po.meanFinalCo,
      LEVEL_FMT,
    );

    setFormula(
      sheet,
      4,
      row,
      `IF(OR(${weightageCell}="",${meanCell}=""),"",${weightageCell}*${meanCell}/3)`,
      po.official,
      LEVEL_FMT,
    );

    // Secondary: Σ(strength × final) ÷ Σ(strength) over the mapped COs
    // that have a final. Terms are written out so both the strengths and
    // the finals are visibly referenced.
    const terms = po.secondaryTerms
      .map((term) => ({ strength: matrix.strength[`${term.coId}:${po.poId}`], final: finalCo.final[term.coId] }))
      .filter((term): term is { strength: string; final: string } => Boolean(term.strength && term.final));
    if (terms.length === 0) {
      setValue(sheet, 5, row, null);
    } else {
      const numerator = terms.map((term) => `${term.strength}*${term.final}`).join('+');
      const denominator = terms.map((term) => term.strength).join('+');
      setFormula(sheet, 5, row, `(${numerator})/(${denominator})`, po.secondary, LEVEL_FMT);
    }

    if (po.weightage === null) {
      setValue(sheet, 6, row, 'No CO maps to this PO/PSO — its attainment cannot be computed.');
    }

    refs.weightage[po.poId] = ref(sheetName, 2, row);
    refs.meanFinal[po.poId] = ref(sheetName, 3, row);
    refs.official[po.poId] = ref(sheetName, 4, row);
    refs.secondary[po.poId] = ref(sheetName, 5, row);
  });

  const noteRow = headerRow + data.result.po.length + 2;
  setNote(sheet, noteRow, 'The secondary column is the CO-weighted alternative Σ(strength × final) ÷ Σ(strength), computed for comparison only.');
  setNote(sheet, noteRow + 1, 'Every value in this workbook was produced by the calculation engine. The formulas show the arithmetic; they are not the source of truth.');

  return refs;
}
