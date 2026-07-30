import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SHEET, buildWorkbookWithIndex } from '../src/index';
import type { WorkbookIndex } from '../src/index';
import type { ExportInput } from '../src/types';
import { buildExportInput } from './fixture';
import { FormulaEvaluator, type Value } from './formulaEval';

/**
 * THE round-trip guarantee: generate the workbook, write it to a real
 * .xlsx buffer, open that buffer fresh, and evaluate every formula
 * INDEPENDENTLY of the cached values — then assert the results agree with
 * the engine.
 *
 * If this ever fails, the export's formulas have drifted from the
 * engine's arithmetic. That is a bug in the export, never in the engine:
 * the engine is the source of truth, and the formulas exist only so a
 * reader can see how a number was reached.
 */

const TOLERANCE = 1e-9;

let data: ExportInput;
let index: WorkbookIndex;
let workbook: ExcelJS.Workbook;
let evaluator: FormulaEvaluator;

/** Splits `'Sheet Name'!$B$5` into its sheet and address. */
function splitRef(reference: string): { sheet: string; address: string } {
  const bang = reference.lastIndexOf('!');
  const rawSheet = reference.slice(0, bang);
  const sheet = rawSheet.startsWith("'") ? rawSheet.slice(1, -1).replace(/''/g, "'") : rawSheet;
  return { sheet, address: reference.slice(bang + 1) };
}

const evaluateRef = (reference: string): Value => {
  const { sheet, address } = splitRef(reference);
  return evaluator.cell(sheet, address);
};

beforeAll(async () => {
  data = buildExportInput();
  const built = buildWorkbookWithIndex(data);
  index = built.index;

  // Round-trip through a real .xlsx file, exactly as a user would receive it.
  const buffer = await built.workbook.xlsx.writeBuffer();
  workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  evaluator = new FormulaEvaluator(workbook);
});

describe('the workbook itself', () => {
  it('contains the required sheets, one per assessment', () => {
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(names).toContain(SHEET.parameters);
    expect(names).toContain(SHEET.matrix);
    expect(names).toContain(SHEET.consolidation);
    expect(names).toContain(SHEET.indirect);
    expect(names).toContain(SHEET.finalCo);
    expect(names).toContain(SHEET.po);
    for (const assessment of data.input.assessments) {
      expect(names, `sheet for ${assessment.name}`).toContain(assessment.name.slice(0, 31));
    }
  });

  it('records the parameters actually applied, and the level each came from', async () => {
    const sheet = workbook.getWorksheet(SHEET.parameters)!;
    const text = JSON.stringify(sheet.getSheetValues());
    expect(text).toContain('Institution default');
    expect(text).toContain('Programme override'); // weightGroups in the fixture
    expect(text).toContain('Course override (minuted exception)'); // targetAttainment
    expect(text).toContain('0.7'); // threshold fraction
  });

  it('writes derived cells as formulas, not pasted values', () => {
    const sheet = workbook.getWorksheet(SHEET.finalCo)!;
    const cell = sheet.getCell(splitRef(index.finalCo['co1']!).address);
    expect(cell.formula, 'final CO attainment must be a live formula').toBeTruthy();
  });

  it('caches the engine value in each formula cell, so the file opens showing the engine’s numbers', () => {
    const { sheet, address } = splitRef(index.finalCo['co1']!);
    const cell = workbook.getWorksheet(sheet)!.getCell(address);
    const cached = (cell.value as ExcelJS.CellFormulaValue).result as number;
    const engineValue = data.result.finalCo.find((co) => co.coId === 'co1')!.final!;
    expect(cached).toBeCloseTo(engineValue, 9);
  });
});

describe('formulas evaluated independently agree with the engine', () => {
  it('Step 1 — PO/PSO weightages', () => {
    for (const entry of data.result.step1.perPo) {
      if (entry.weightage === null) continue;
      expect(evaluateRef(index.weightage[entry.poId]!), `weightage ${entry.poId}`).toBeCloseTo(entry.weightage, 9);
    }
  });

  it('Step 3 — every item level', () => {
    let checked = 0;
    for (const score of data.result.itemScores) {
      const reference = index.itemLevel[`${score.assessmentId}:${score.itemId}`];
      if (!reference) continue;
      const evaluated = evaluateRef(reference);
      if (score.level === null) {
        expect(evaluated, `item ${score.itemId} was unattempted → blank, never 0`).toBe('');
      } else {
        expect(evaluated, `item ${score.itemId}`).toBeCloseTo(score.level, 9);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('Step 4 — each assessment’s level for each CO', () => {
    for (const row of data.result.assessmentCo) {
      const reference = index.assessmentCoLevel[`${row.assessmentId}:${row.coId}`];
      expect(reference, `cell for ${row.assessmentId}:${row.coId}`).toBeTruthy();
      const evaluated = evaluateRef(reference!);
      if (row.level === null) expect(evaluated).toBe('');
      else expect(evaluated, `${row.assessmentId}:${row.coId}`).toBeCloseTo(row.level, 9);
    }
  });

  it('Steps 5–7 — each weight group’s level for each CO', () => {
    for (const row of data.result.groupCo) {
      const reference = index.groupLevel[`${row.groupId}:${row.coId}`];
      expect(evaluateRef(reference!), `${row.groupId}:${row.coId}`).toBeCloseTo(row.level, 9);
    }
  });

  it('Step 8 — indirect attainment', () => {
    for (const row of data.result.indirect) {
      const evaluated = evaluateRef(index.indirect[row.coId]!);
      if (row.value === null) expect(evaluated).toBe('');
      else expect(evaluated, `indirect ${row.coId}`).toBeCloseTo(row.value, 9);
    }
  });

  it('Step 9 — direct and final CO attainment', () => {
    for (const co of data.result.finalCo) {
      const direct = evaluateRef(index.direct[co.coId]!);
      if (co.direct === null) expect(direct).toBeNull();
      else expect(direct, `direct ${co.coId}`).toBeCloseTo(co.direct, 9);

      const final = evaluateRef(index.finalCo[co.coId]!);
      if (co.final === null) expect(final).toBe('');
      else expect(final, `final ${co.coId}`).toBeCloseTo(co.final, 9);
    }
  });

  it('Step 10 — mean final CO, official and secondary PO figures', () => {
    for (const po of data.result.po) {
      if (po.meanFinalCo !== null) {
        expect(evaluateRef(index.poMeanFinal[po.poId]!), `mean ${po.poId}`).toBeCloseTo(po.meanFinalCo, 9);
      }
      if (po.official !== null) {
        expect(evaluateRef(index.poOfficial[po.poId]!), `official ${po.poId}`).toBeCloseTo(po.official, 9);
      }
      if (po.secondary !== null) {
        expect(evaluateRef(index.poSecondary[po.poId]!), `secondary ${po.poId}`).toBeCloseTo(po.secondary, 9);
      }
    }
  });

  it('every formula in the workbook evaluates without error', () => {
    let formulaCount = 0;
    for (const sheet of workbook.worksheets) {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const value = cell.value as unknown;
          if (value && typeof value === 'object' && 'formula' in (value as object)) {
            formulaCount += 1;
            expect(() => evaluator.cell(sheet.name, cell.address), `${sheet.name}!${cell.address}`).not.toThrow();
          }
        });
      });
    }
    expect(formulaCount, 'the workbook should be full of live formulas').toBeGreaterThan(40);
  });
});

describe('the engine still produces the hand-computed figures', () => {
  // These are the values worked out by hand in the engine's own fixture;
  // asserting them here ties the export to a known-correct computation
  // rather than to whatever the engine happens to output.
  it('final CO attainment: 2.115 / 2.05 / 2.21', () => {
    const finals = Object.fromEntries(data.result.finalCo.map((co) => [co.coId, co.final]));
    expect(finals['co1']).toBeCloseTo(2.115, 9);
    expect(finals['co2']).toBeCloseTo(2.05, 9);
    expect(finals['co3']).toBeCloseTo(2.21, 9);
  });

  it('PO attainment: PO1 official 17/9, secondary 2.134375; PO2 official 1.0625', () => {
    const po1 = data.result.po.find((po) => po.poId === 'po1')!;
    const po2 = data.result.po.find((po) => po.poId === 'po2')!;
    expect(po1.official).toBeCloseTo(17 / 9, 9);
    expect(po1.secondary).toBeCloseTo(2.134375, 9);
    expect(po2.official).toBeCloseTo(1.0625, 9);
  });

  it('and the workbook reproduces them through its own formulas', () => {
    expect(evaluateRef(index.finalCo['co1']!)).toBeCloseTo(2.115, 9);
    expect(evaluateRef(index.poOfficial['po1']!)).toBeCloseTo(17 / 9, 9);
    expect(evaluateRef(index.poSecondary['po1']!)).toBeCloseTo(2.134375, 9);
  });
});

describe('tolerance', () => {
  it('agreement is asserted to a tight floating-point tolerance', () => {
    const engine = data.result.finalCo.find((co) => co.coId === 'co3')!.final!;
    const evaluated = evaluateRef(index.finalCo['co3']!) as number;
    expect(Math.abs(evaluated - engine)).toBeLessThan(TOLERANCE);
  });
});
