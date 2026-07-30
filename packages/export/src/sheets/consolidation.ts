import type ExcelJS from 'exceljs';
import { LEVEL_FMT, ref, setFormula, setHeader, setNote, setTitle, setValue } from '../cells';
import type { AssessmentRefs } from './assessments';
import type { ExportInput } from '../types';

export interface ConsolidationRefs {
  /** `${groupId}:${coId}` → the group-level cell (Step 5). */
  groupLevel: Record<string, string>;
}

/**
 * Steps 5–7 — consolidation. Rows are COs; one column per assessment
 * carries that assessment's level for the CO, and one column per weight
 * group averages the assessments of that group.
 *
 * A CO that does not appear in an assessment leaves that cell EMPTY, and
 * Excel's AVERAGE ignores empty cells — which is precisely the
 * Procedure's rule: average over the assessments in which the CO appears,
 * never over those it is absent from (§9's "averaged over four sections
 * in one test and three in another" fault).
 */
export function buildConsolidationSheet(
  workbook: ExcelJS.Workbook,
  data: ExportInput,
  assessments: AssessmentRefs,
  sheetName: string,
): ConsolidationRefs {
  const sheet = workbook.addWorksheet(sheetName);
  const groupIds = Object.keys(data.result.parameters.weightGroups);
  const assessmentList = data.input.assessments;

  sheet.columns = [
    { width: 12 },
    ...assessmentList.map(() => ({ width: 18 })),
    ...groupIds.map(() => ({ width: 16 })),
  ];

  setTitle(sheet, 1, 'Consolidation by weight group (Steps 5–7)');
  setNote(sheet, 2, 'Blank = the CO is not assessed there. Group level = mean of the assessments in that group in which the CO appears.');

  const headerRow = 4;
  setHeader(sheet, headerRow, [
    'CO',
    ...assessmentList.map((assessment) => assessment.name),
    ...groupIds.map((groupId) => `${groupId} (Step 5)`),
  ]);

  const groupLevel: ConsolidationRefs['groupLevel'] = {};
  const groupOfAssessment = new Map(assessmentList.map((assessment) => [assessment.id, assessment.weightGroup]));

  data.input.cos.forEach((co, index) => {
    const row = headerRow + 1 + index;
    setValue(sheet, 1, row, data.refs.coCodeById[co.id] ?? co.id);

    // One column per assessment, referencing that sheet's CO-level cell.
    const assessmentCellByGroup: Record<string, string[]> = {};
    assessmentList.forEach((assessment, assessmentIndex) => {
      const column = 2 + assessmentIndex;
      const source = assessments.coLevel[`${assessment.id}:${co.id}`];
      const engineValue = data.result.assessmentCo.find((r) => r.assessmentId === assessment.id && r.coId === co.id)?.level ?? null;
      if (source) {
        setFormula(sheet, column, row, source, engineValue, LEVEL_FMT);
        const group = groupOfAssessment.get(assessment.id)!;
        (assessmentCellByGroup[group] ??= []).push(ref(sheetName, column, row));
      } else {
        setValue(sheet, column, row, null); // genuinely empty: not assessed here
      }
    });

    // One column per weight group.
    groupIds.forEach((groupId, groupIndex) => {
      const column = 2 + assessmentList.length + groupIndex;
      const cells = assessmentCellByGroup[groupId] ?? [];
      const engineValue = data.result.groupCo.find((g) => g.groupId === groupId && g.coId === co.id)?.level ?? null;
      if (cells.length === 0) {
        setValue(sheet, column, row, null);
      } else {
        setFormula(sheet, column, row, `AVERAGE(${cells.join(',')})`, engineValue, LEVEL_FMT);
      }
      groupLevel[`${groupId}:${co.id}`] = ref(sheetName, column, row);
    });
  });

  return { groupLevel };
}
