import type ExcelJS from 'exceljs';
import { LEVEL_FMT, ref, setHeader, setNote, setTitle, setValue } from '../cells';
import type { ExportInput } from '../types';

/**
 * Stable references to the parameter cells, so every other sheet's
 * formulas point at the ONE place the parameters in force are recorded.
 */
export interface ParamRefs {
  thresholdFraction: string;
  directWeight: string;
  indirectWeight: string;
  targetAttainment: string;
  /** Sorted by lower bound, descending — the order the rubric is read. */
  bands: { lowerBound: string; level: string }[];
  /** groupId → weight cell. */
  weightGroups: Record<string, string>;
  /** Sorted by level, descending. */
  cohortBands: { scorePercent: string; cohortPercent: string; level: string }[];
}

const SOURCE_LABEL: Record<string, string> = {
  institution: 'Institution default',
  programme: 'Programme override',
  course: 'Course override (minuted exception)',
};

/**
 * The parameters actually applied to THIS course, and the level each was
 * inherited from (§4). An auditor reading a figure elsewhere in the
 * workbook can see exactly which rule produced it.
 */
export function buildParametersSheet(workbook: ExcelJS.Workbook, data: ExportInput, sheetName: string): ParamRefs {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = [{ width: 42 }, { width: 14 }, { width: 32 }, { width: 52 }];
  const p = data.result.parameters;
  const source = (field: string): string =>
    data.provenance ? (SOURCE_LABEL[data.provenance[field as keyof typeof data.provenance]] ?? '—') : 'recorded in snapshot';

  setTitle(sheet, 1, 'Attainment parameters in force for this course');
  setValue(sheet, 1, 2, `${data.course.code} — ${data.course.title}`);
  setNote(sheet, 3, 'Every figure in this workbook was produced by the calculation engine using exactly these values.');

  let row = 5;
  setHeader(sheet, row, ['Parameter', 'Value', 'Inherited from', 'Note']);
  row += 1;

  const scalar = (label: string, value: number, field: string, note: string): string => {
    setValue(sheet, 1, row, label);
    const cell = setValue(sheet, 2, row, value);
    setValue(sheet, 3, row, source(field));
    setValue(sheet, 4, row, note);
    const address = ref(sheetName, 2, row);
    row += 1;
    void cell;
    return address;
  };

  const thresholdFraction = scalar(
    'Item threshold (fraction of the item maximum)',
    p.thresholdFraction,
    'thresholdFraction',
    'A mark is attained when mark ≥ fraction × item maximum (§4.1).',
  );
  const directWeight = scalar('Direct weight', p.directWeight, 'directWeight', 'Final = direct weight × direct + indirect weight × indirect (Step 9).');
  const indirectWeight = scalar('Indirect weight', p.indirectWeight, 'indirectWeight', '');
  const targetAttainment = scalar('Target attainment', p.targetAttainment, 'targetAttainment', 'COs below this are flagged for gap analysis (§4.5).');
  scalar('Feedback response floor', p.feedbackResponseFloor, 'feedbackResponseFloor', '0 disables the check (§5.1).');

  // ── attainment bands ──
  row += 1;
  setTitle(sheet, row, 'Attainment bands (§4.2)');
  row += 1;
  setValue(sheet, 1, row, `Inherited from: ${source('bands')}`);
  row += 1;
  setHeader(sheet, row, ['Students clearing the threshold (%) — at least', 'Level', '', 'Note']);
  setValue(sheet, 4, row, 'Read from the highest bound satisfied.');
  row += 1;

  const sortedBands = [...p.bands].sort((a, b) => b.lowerBound - a.lowerBound);
  const bands = sortedBands.map((band) => {
    setValue(sheet, 1, row, band.lowerBound);
    setValue(sheet, 2, row, band.level);
    const entry = { lowerBound: ref(sheetName, 1, row), level: ref(sheetName, 2, row) };
    row += 1;
    return entry;
  });

  // ── weight groups ──
  row += 1;
  setTitle(sheet, row, 'Weight groups (§4.4, Step 9)');
  row += 1;
  setValue(sheet, 1, row, `Inherited from: ${source('weightGroups')}`);
  row += 1;
  setHeader(sheet, row, ['Group', 'Weight', '', 'Note']);
  setValue(sheet, 4, row, 'Group weights are validated to sum to 1.00.');
  row += 1;

  const weightGroups: Record<string, string> = {};
  const weightCells: string[] = [];
  for (const [groupId, weight] of Object.entries(p.weightGroups)) {
    setValue(sheet, 1, row, groupId);
    setValue(sheet, 2, row, weight);
    weightGroups[groupId] = ref(sheetName, 2, row);
    weightCells.push(ref(sheetName, 2, row));
    row += 1;
  }
  setValue(sheet, 1, row, 'Total');
  sheet.getCell(row, 2).value = { formula: `SUM(${weightCells.join(',')})`, result: 1 } as ExcelJS.CellFormulaValue;
  sheet.getCell(row, 2).numFmt = LEVEL_FMT;
  row += 2;

  // ── end-semester cohort bands ──
  setTitle(sheet, row, 'End-semester cohort bands (§4.3, Step 7)');
  row += 1;
  setValue(sheet, 1, row, `Inherited from: ${source('cohortBands')}`);
  row += 1;
  setHeader(sheet, row, ['Score cut-off (% of paper maximum)', 'Students required (%)', 'Level', 'Note']);
  setValue(sheet, 4, row, 'First row satisfied decides the level; none satisfied → 0.');
  row += 1;

  const cohortBands = [...p.cohortBands]
    .sort((a, b) => b.level - a.level)
    .map((band) => {
      setValue(sheet, 1, row, band.scorePercent);
      setValue(sheet, 2, row, band.cohortPercent);
      setValue(sheet, 3, row, band.level);
      const entry = {
        scorePercent: ref(sheetName, 1, row),
        cohortPercent: ref(sheetName, 2, row),
        level: ref(sheetName, 3, row),
      };
      row += 1;
      return entry;
    });

  return { thresholdFraction, directWeight, indirectWeight, targetAttainment, bands, weightGroups, cohortBands };
}
