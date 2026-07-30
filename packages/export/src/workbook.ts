import ExcelJS from 'exceljs';
import { sanitizeSheetName, setNote, setTitle, setValue } from './cells';
import { buildParametersSheet } from './sheets/parameters';
import { buildMatrixSheet } from './sheets/matrix';
import { buildAssessmentSheets } from './sheets/assessments';
import { buildConsolidationSheet } from './sheets/consolidation';
import { buildIndirectSheet } from './sheets/indirect';
import { buildFinalCoSheet } from './sheets/finalCo';
import { buildPoSheet } from './sheets/po';
import type { ExportInput } from './types';

/** Fixed sheet names, so exported files stay consistent between courses. */
export const SHEET = {
  cover: 'Course',
  parameters: 'Parameters',
  matrix: 'Articulation Matrix',
  consolidation: 'Consolidation',
  indirect: 'Indirect Feedback',
  finalCo: 'CO Attainment',
  po: 'PO-PSO Attainment',
} as const;

/**
 * Builds the departmental workbook for one course.
 *
 * Sheet order follows the Procedure's ten steps: the course cover, the
 * parameters in force, the articulation matrix (Step 1), one sheet per
 * assessment (Steps 3–4, 7), the consolidation (Steps 5–6), indirect
 * feedback (Step 8), final CO attainment (Step 9) and PO/PSO attainment
 * (Step 10).
 *
 * Every derived cell is a live formula whose cached value is the
 * ENGINE'S number: the workbook opens showing the engine's figures and a
 * reader can see — and recalculate — the arithmetic behind each one. The
 * formulas are documentation, never the source of truth.
 */
/**
 * Semantic key → cell address, so callers (and the round-trip test) can
 * find a figure without hard-coding spreadsheet coordinates.
 */
export interface WorkbookIndex {
  weightage: Record<string, string>;
  itemLevel: Record<string, string>;
  assessmentCoLevel: Record<string, string>;
  groupLevel: Record<string, string>;
  indirect: Record<string, string>;
  direct: Record<string, string>;
  finalCo: Record<string, string>;
  poMeanFinal: Record<string, string>;
  poOfficial: Record<string, string>;
  poSecondary: Record<string, string>;
}

export function buildWorkbookWithIndex(data: ExportInput): { workbook: ExcelJS.Workbook; index: WorkbookIndex } {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CO-PO Attainment System';
  workbook.created = data.course.generatedAt;

  buildCoverSheet(workbook, data);

  const params = buildParametersSheet(workbook, data, SHEET.parameters);
  const matrix = buildMatrixSheet(workbook, data, SHEET.matrix);

  // Assessment sheet names are user data: sanitise and de-duplicate, and
  // reserve the fixed names first so a course cannot collide with them.
  const taken = new Set(Object.values(SHEET).map((name) => name.toLowerCase()));
  const assessmentSheetNames: Record<string, string> = {};
  for (const assessment of data.input.assessments) {
    assessmentSheetNames[assessment.id] = sanitizeSheetName(assessment.name, taken);
  }

  const assessments = buildAssessmentSheets(workbook, data, params, assessmentSheetNames);
  const consolidation = buildConsolidationSheet(workbook, data, assessments, SHEET.consolidation);
  const indirect = buildIndirectSheet(workbook, data, SHEET.indirect);
  const finalCo = buildFinalCoSheet(workbook, data, params, consolidation, indirect, SHEET.finalCo);
  const po = buildPoSheet(workbook, data, matrix, finalCo, SHEET.po);

  return {
    workbook,
    index: {
      weightage: matrix.weightage,
      itemLevel: assessments.itemLevel,
      assessmentCoLevel: assessments.coLevel,
      groupLevel: consolidation.groupLevel,
      indirect: indirect.value,
      direct: finalCo.direct,
      finalCo: finalCo.final,
      poMeanFinal: po.meanFinal,
      poOfficial: po.official,
      poSecondary: po.secondary,
    },
  };
}

export function buildWorkbook(data: ExportInput): ExcelJS.Workbook {
  return buildWorkbookWithIndex(data).workbook;
}

export async function buildWorkbookBuffer(data: ExportInput): Promise<Buffer> {
  const workbook = buildWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportFileName(data: ExportInput): string {
  const safe = `${data.course.code}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const date = data.course.generatedAt.toISOString().slice(0, 10);
  const version = data.course.snapshotVersion === null ? 'live' : `v${data.course.snapshotVersion}`;
  return `CO-PO_${safe}_${version}_${date}.xlsx`;
}

function buildCoverSheet(workbook: ExcelJS.Workbook, data: ExportInput): void {
  const sheet = workbook.addWorksheet(SHEET.cover);
  sheet.columns = [{ width: 28 }, { width: 60 }];

  setTitle(sheet, 1, 'CO – PO / PSO Attainment');
  let row = 3;
  const line = (label: string, value: string) => {
    setValue(sheet, 1, row, label);
    sheet.getCell(row, 1).font = { bold: true };
    setValue(sheet, 2, row, value);
    row += 1;
  };

  line('Course', `${data.course.code} — ${data.course.title}`);
  line('Semester', String(data.course.semester));
  line('Programme', data.course.programmeName);
  line('Department', data.course.departmentName);
  line('Batch', data.course.batchName);
  line('Status', data.course.status);
  line(
    'Figures from',
    data.course.snapshotVersion === null
      ? 'live computation from the marks as they stand'
      : `locked snapshot version ${data.course.snapshotVersion}`,
  );
  line('Engine version', data.course.engineVersion);
  line('Generated', data.course.generatedAt.toISOString());

  // Computation warnings are deliberately NOT exported: they are working
  // notes for the person preparing the course and are shown in the
  // application, not in the filed workbook.
  //
  // The one fact §5.1 requires the report itself to state is disclosed
  // here as method rather than as a warning: a declared weight group that
  // nothing assessed has its weight redistributed. (A CO with no feedback
  // already reads "direct-only" on the final-CO sheet.)
  const redistributed = [
    ...new Map(
      data.result.finalCo
        .flatMap((co) => co.groupTerms)
        .filter((term) => term.weightUsed !== term.declaredWeight)
        .map((term) => [term.groupId, term] as const),
    ).values(),
  ];
  if (redistributed.length > 0) {
    row += 1;
    setTitle(sheet, row, 'Weight redistribution (§5.1)');
    row += 1;
    for (const term of redistributed) {
      setValue(sheet, 1, row, term.groupId);
      setValue(sheet, 2, row, `declared ${term.declaredWeight}, applied ${term.weightUsed} — no assessment belongs to this group`);
      row += 1;
    }
  }

  row += 1;
  setNote(sheet, row, 'Every number in this workbook was produced by the calculation engine.');
  setNote(sheet, row + 1, 'The cells contain live formulas so the arithmetic can be read and recalculated — but the engine, not the spreadsheet, is the source of truth.');
}
