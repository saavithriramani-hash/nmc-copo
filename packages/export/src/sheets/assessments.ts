import type ExcelJS from 'exceljs';
import type { Assessment, ItemScore } from '@copo/engine';
import { LEVEL_FMT, MARK_FMT, PCT_FMT, ref, setFormula, setHeader, setNote, setTitle, setValue } from '../cells';
import type { ParamRefs } from './parameters';
import type { ExportInput } from '../types';

export interface AssessmentRefs {
  /** assessmentId → sheet name. */
  sheetNameById: Record<string, string>;
  /** `${assessmentId}:${coId}` → the assessment-level CO cell (Step 4). */
  coLevel: Record<string, string>;
  /** `${assessmentId}:${itemId}` → the item level cell (Step 3). */
  itemLevel: Record<string, string>;
}

interface SheetItem {
  id: string;
  maxMark: number;
  coTag: string | null;
  sectionId: string | null;
}

/**
 * Flattens an assessment into the items the sheet lists, in display
 * order. Display labels are not on the engine's Item — they come from
 * refs.itemLabelById, which is captured at export time.
 */
function itemsOf(assessment: Assessment): SheetItem[] {
  if (assessment.shape === 'SECTIONED') {
    return (assessment.sections ?? []).flatMap((section) =>
      section.items.map((item) => ({ id: item.id, maxMark: item.maxMark, coTag: item.coTag, sectionId: section.id })),
    );
  }
  if (assessment.shape === 'ITEM_LIST') {
    return (assessment.items ?? []).map((item) => ({ id: item.id, maxMark: item.maxMark, coTag: item.coTag, sectionId: null }));
  }
  // SINGLE_SCORE: one pseudo-item keyed by the assessment id.
  return [{ id: assessment.id, maxMark: assessment.maxMark ?? 0, coTag: null, sectionId: null }];
}

/**
 * Builds the nested IF that reads a level from the rubric band table —
 * the arithmetic of §4.2 made visible in the cell.
 *   IF(pct>=80, 3, IF(pct>=60, 2, IF(pct>=40, 1, 0)))
 * Guarded so an item nobody attempted yields blank, never 0.
 */
function bandLookupFormula(pctCell: string, attemptedCell: string, params: ParamRefs): string {
  const bands = params.bands;
  const last = bands[bands.length - 1];
  if (!last) return '""';
  let expression = last.level;
  for (let i = bands.length - 2; i >= 0; i -= 1) {
    const band = bands[i]!;
    expression = `IF(${pctCell}>=${band.lowerBound},${band.level},${expression})`;
  }
  return `IF(${attemptedCell}=0,"",${expression})`;
}

/**
 * One sheet per assessment: item-wise attempted, cleared, percentage and
 * level (Step 3), then the CO roll-up for this assessment (Step 4).
 *
 * Attempted and cleared are LITERAL counts from the engine — they are the
 * raw inputs the visible arithmetic bottoms out at. Everything derived
 * from them is a formula.
 */
export function buildAssessmentSheets(
  workbook: ExcelJS.Workbook,
  data: ExportInput,
  params: ParamRefs,
  sheetNames: Record<string, string>,
): AssessmentRefs {
  const coLevel: AssessmentRefs['coLevel'] = {};
  const allItemLevels: AssessmentRefs['itemLevel'] = {};

  for (const assessment of data.input.assessments) {
    const sheetName = sheetNames[assessment.id]!;
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = [
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 8 },
      { width: 11 },
      { width: 11 },
      { width: 10 },
      { width: 12 },
      { width: 9 },
    ];

    setTitle(sheet, 1, `${assessment.name} — item-wise analysis (Step 3)`);
    setValue(
      sheet,
      1,
      2,
      `Shape: ${assessment.shape} · Scoring: ${assessment.scoringRule} · Weight group: ${assessment.weightGroup}`,
    );

    const isCohort = assessment.scoringRule === 'COHORT_BAND';
    const items = itemsOf(assessment);
    const scoreOf = (itemId: string): ItemScore | undefined =>
      data.result.itemScores.find((s) => s.assessmentId === assessment.id && s.itemId === itemId);

    let row = 4;
    const itemLevelCell: Record<string, string> = {};

    if (!isCohort) {
      setHeader(sheet, row, ['Item', 'Section', 'CO', 'Max', 'Threshold', 'Attempted', 'Cleared', '% cleared', 'Level']);
      row += 1;
      const firstItemRow = row;

      for (const item of items) {
        const score = scoreOf(item.id);
        setValue(sheet, 1, row, data.refs.itemLabelById[item.id] ?? item.id);
        setValue(sheet, 2, row, item.sectionId ? (data.refs.sectionNameById[item.sectionId] ?? item.sectionId) : '—');
        setValue(sheet, 3, row, item.coTag ? (data.refs.coCodeById[item.coTag] ?? item.coTag) : 'all COs');
        const maxCell = setValue(sheet, 4, row, item.maxMark, MARK_FMT);
        // Threshold shown as the arithmetic that defines it (§4.1).
        setFormula(sheet, 5, row, `${params.thresholdFraction}*${maxCell}`, score ? score.thresholdMark : null, MARK_FMT);
        const attemptedCell = setValue(sheet, 6, row, score?.attempted ?? 0);
        const clearedCell = setValue(sheet, 7, row, score?.cleared ?? 0);
        const pctCell = setFormula(
          sheet,
          8,
          row,
          `IF(${attemptedCell}=0,"",${clearedCell}/${attemptedCell}*100)`,
          score?.pct ?? null,
          PCT_FMT,
        );
        setFormula(sheet, 9, row, bandLookupFormula(pctCell, attemptedCell, params), score?.level ?? null);
        itemLevelCell[item.id] = ref(sheetName, 9, row);
        allItemLevels[`${assessment.id}:${item.id}`] = ref(sheetName, 9, row);
        row += 1;
      }
      void firstItemRow;
      setNote(sheet, row, 'Attempted counts non-blank marks only: a blank is "did not attempt" and is excluded from the denominator; a 0 is an attempted mark and is included.');
      row += 2;
    }

    // ── Step 4: this assessment's level for each CO ──
    const assessmentCoRows = data.result.assessmentCo.filter((r) => r.assessmentId === assessment.id);

    if (isCohort) {
      const cohort = assessmentCoRows[0]?.cohort;
      setTitle(sheet, row, 'End-semester cohort bands (Step 7, §4.3)');
      row += 1;
      setHeader(sheet, row, ['Score cut-off', 'Students at or above', 'Attempted', '% of attempted', 'Required %', 'Passes']);
      row += 1;

      const passCells: { pct: string; required: string; level: string }[] = [];
      (cohort?.bands ?? []).forEach((band, index) => {
        const paramBand = params.cohortBands[index];
        const maxMark = cohort?.maxMark ?? 0;
        setFormula(
          sheet,
          1,
          row,
          `${paramBand?.scorePercent ?? 0}/100*${maxMark}`,
          ((band.scorePercent / 100) * maxMark) || 0,
          MARK_FMT,
        );
        const atOrAbove = setValue(sheet, 2, row, band.studentsAtOrAbove);
        const attempted = setValue(sheet, 3, row, cohort?.attempted ?? 0);
        const pctCell = setFormula(
          sheet,
          4,
          row,
          `IF(${attempted}=0,"",${atOrAbove}/${attempted}*100)`,
          band.pctOfStudents,
          PCT_FMT,
        );
        setValue(sheet, 5, row, band.cohortPercent);
        setFormula(sheet, 6, row, `IF(${pctCell}="","",IF(${pctCell}>=${paramBand?.cohortPercent ?? 50},1,0))`, band.passed ? 1 : 0);
        passCells.push({
          pct: pctCell,
          required: paramBand?.cohortPercent ?? String(band.cohortPercent),
          level: paramBand?.level ?? String(band.level),
        });
        row += 1;
      });

      // Level = first band whose cohort test passes, else 0.
      let expression = '0';
      for (let i = passCells.length - 1; i >= 0; i -= 1) {
        const entry = passCells[i]!;
        expression = `IF(AND(${entry.pct}<>"",${entry.pct}>=${entry.required}),${entry.level},${expression})`;
      }
      const attemptedTotal = cohort?.attempted ?? 0;
      const levelFormula = attemptedTotal === 0 ? '""' : expression;
      setValue(sheet, 1, row, 'Level');
      sheet.getCell(row, 1).font = { bold: true };
      const levelCell = setFormula(sheet, 2, row, levelFormula, cohort?.level ?? null);
      row += 2;

      setTitle(sheet, row, 'CO attainment from this assessment (Step 4)');
      row += 1;
      setHeader(sheet, row, ['CO', 'Level']);
      row += 1;
      for (const coRow of assessmentCoRows) {
        setValue(sheet, 1, row, data.refs.coCodeById[coRow.coId] ?? coRow.coId);
        // Every tagged CO takes the one cohort level computed above.
        setFormula(sheet, 2, row, levelCell, coRow.level, LEVEL_FMT);
        coLevel[`${assessment.id}:${coRow.coId}`] = ref(sheetName, 2, row);
        row += 1;
      }
      setNote(sheet, row, 'The end-semester paper is scored on the total mark only (§4.3); its level applies to every CO it is tagged to — all COs when untagged.');
      continue;
    }

    setTitle(sheet, row, 'CO attainment from this assessment (Step 4)');
    row += 1;

    if (assessment.shape === 'SECTIONED') {
      setHeader(sheet, row, ['CO', 'Section', 'Section level', '', 'CO level (mean across sections)']);
      row += 1;
      for (const coRow of assessmentCoRows) {
        const sectionCells: string[] = [];
        const startRow = row;
        for (const section of coRow.sections ?? []) {
          const levels = section.itemLevels.filter((entry) => entry.level !== null).map((entry) => itemLevelCell[entry.itemId]!);
          setValue(sheet, 1, row, data.refs.coCodeById[coRow.coId] ?? coRow.coId);
          setValue(sheet, 2, row, data.refs.sectionNameById[section.sectionId] ?? section.sectionId);
          setFormula(
            sheet,
            3,
            row,
            levels.length > 0 ? `AVERAGE(${levels.join(',')})` : '""',
            section.level,
            LEVEL_FMT,
          );
          sectionCells.push(ref(sheetName, 3, row));
          row += 1;
        }
        // The CO's level for this assessment: mean across the sections in
        // which the CO appears (never over sections it is absent from).
        setFormula(
          sheet,
          5,
          startRow,
          sectionCells.length > 0 ? `AVERAGE(${sectionCells.join(',')})` : '""',
          coRow.level,
          LEVEL_FMT,
        );
        coLevel[`${assessment.id}:${coRow.coId}`] = ref(sheetName, 5, startRow);
      }
    } else {
      setHeader(sheet, row, ['CO', 'Item levels averaged', 'CO level']);
      row += 1;
      for (const coRow of assessmentCoRows) {
        const cells = (coRow.items ?? [])
          .filter((entry) => entry.level !== null)
          .map((entry) => itemLevelCell[entry.itemId]!)
          .filter(Boolean);
        setValue(sheet, 1, row, data.refs.coCodeById[coRow.coId] ?? coRow.coId);
        setValue(sheet, 2, row, (coRow.items ?? []).map((entry) => data.refs.itemLabelById[entry.itemId] ?? entry.itemId).join(', '));
        setFormula(sheet, 3, row, cells.length > 0 ? `AVERAGE(${cells.join(',')})` : '""', coRow.level, LEVEL_FMT);
        coLevel[`${assessment.id}:${coRow.coId}`] = ref(sheetName, 3, row);
        row += 1;
      }
    }
  }

  return { sheetNameById: sheetNames, coLevel, itemLevel: allItemLevels };
}
