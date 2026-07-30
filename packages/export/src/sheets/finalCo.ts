import type ExcelJS from 'exceljs';
import { LEVEL_FMT, ref, setFormula, setHeader, setNote, setTitle, setValue } from '../cells';
import type { ConsolidationRefs } from './consolidation';
import type { IndirectRefs } from './indirect';
import type { ParamRefs } from './parameters';
import type { ExportInput } from '../types';

export interface FinalCoRefs {
  /** coId → the final attainment cell. */
  final: Record<string, string>;
  /** coId → the direct attainment cell. */
  direct: Record<string, string>;
  /** The whole final column, for the mean on the PO sheet. */
  finalColumn: { column: number; firstRow: number; lastRow: number };
  sheetName: string;
}

/**
 * Step 9 — final CO attainment.
 *
 * The direct formula is written as Σ(weight × group level) ÷ Σ(weight)
 * over the groups that assessed the CO. With every group present the
 * denominator is 1 and it is the Procedure's plain weighted sum; where a
 * group did not assess the CO, the same formula shows the proportional
 * redistribution (§5.1) instead of hiding it.
 */
export function buildFinalCoSheet(
  workbook: ExcelJS.Workbook,
  data: ExportInput,
  params: ParamRefs,
  consolidation: ConsolidationRefs,
  indirect: IndirectRefs,
  sheetName: string,
): FinalCoRefs {
  const sheet = workbook.addWorksheet(sheetName);
  const groupIds = Object.keys(data.result.parameters.weightGroups);
  sheet.columns = [
    { width: 12 },
    ...groupIds.map(() => ({ width: 15 })),
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
  ];

  setTitle(sheet, 1, 'Final CO attainment (Step 9)');
  setNote(sheet, 2, 'Direct = Σ(weight × group level) ÷ Σ(weight) over the groups that assessed the CO. Final = direct weight × direct + indirect weight × indirect.');

  const headerRow = 4;
  setHeader(sheet, headerRow, [
    'CO',
    ...groupIds.map((groupId) => `${groupId} level`),
    'Direct',
    'Indirect',
    'Final',
    'Target',
    'Below target?',
  ]);

  const directColumn = 2 + groupIds.length;
  const indirectColumn = directColumn + 1;
  const finalColumn = directColumn + 2;
  const targetColumn = directColumn + 3;
  const flagColumn = directColumn + 4;

  const final: FinalCoRefs['final'] = {};
  const direct: FinalCoRefs['direct'] = {};
  const firstRow = headerRow + 1;

  data.input.cos.forEach((co, index) => {
    const row = firstRow + index;
    const engine = data.result.finalCo.find((r) => r.coId === co.id);
    setValue(sheet, 1, row, data.refs.coCodeById[co.id] ?? co.id);

    // Group level columns, referencing the consolidation sheet.
    const localGroupCell: Record<string, string> = {};
    groupIds.forEach((groupId, groupIndex) => {
      const column = 2 + groupIndex;
      const source = consolidation.groupLevel[`${groupId}:${co.id}`];
      const engineLevel = data.result.groupCo.find((g) => g.groupId === groupId && g.coId === co.id)?.level ?? null;
      if (source && engineLevel !== null) {
        setFormula(sheet, column, row, source, engineLevel, LEVEL_FMT);
        localGroupCell[groupId] = ref(sheetName, column, row);
      } else {
        setValue(sheet, column, row, null);
      }
    });

    // Direct — only the groups that actually assessed this CO.
    const terms = (engine?.groupTerms ?? []).filter((term) => localGroupCell[term.groupId]);
    let directCell: string;
    if (terms.length === 0) {
      directCell = setValue(sheet, directColumn, row, null);
    } else {
      const numerator = terms.map((term) => `${params.weightGroups[term.groupId]}*${localGroupCell[term.groupId]}`).join('+');
      const denominator = terms.map((term) => params.weightGroups[term.groupId]).join('+');
      directCell = setFormula(sheet, directColumn, row, `(${numerator})/(${denominator})`, engine?.direct ?? null, LEVEL_FMT);
    }
    direct[co.id] = ref(sheetName, directColumn, row);

    // Indirect, referencing the feedback sheet.
    const indirectCell = setFormula(sheet, indirectColumn, row, indirect.value[co.id]!, engine?.indirect ?? null, LEVEL_FMT);

    // Final — direct-only when there is no feedback (§5.1), never zero-filled.
    const formula =
      terms.length === 0
        ? '""'
        : engine?.directOnly
          ? directCell
          : `${params.directWeight}*${directCell}+${params.indirectWeight}*${indirectCell}`;
    setFormula(sheet, finalColumn, row, formula, engine?.final ?? null, LEVEL_FMT);
    final[co.id] = ref(sheetName, finalColumn, row);

    setFormula(sheet, targetColumn, row, params.targetAttainment, data.result.parameters.targetAttainment, LEVEL_FMT);

    // The below-target flag is textual, so its cached result is the
    // engine's verdict rather than a number.
    const finalRef = ref(sheetName, finalColumn, row);
    sheet.getCell(row, flagColumn).value = {
      formula: `IF(${finalRef}="","",IF(${finalRef}<${params.targetAttainment},"below","met"))`,
      result: engine?.belowTarget === null || engine?.belowTarget === undefined ? '' : engine.belowTarget ? 'below' : 'met',
    } as ExcelJS.CellFormulaValue;
  });

  const lastRow = firstRow + data.input.cos.length - 1;
  setNote(sheet, lastRow + 2, 'A CO with no direct value is left blank: it was assessed nowhere, and absence is never counted as zero.');

  return { final, direct, finalColumn: { column: finalColumn, firstRow, lastRow }, sheetName };
}
