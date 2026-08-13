import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { computeKnowledgeLevels, DEFAULT_PARAMETERS } from '@copo/engine';
import { buildLearningOutcomeWorkbook, type LearningOutcomeInput } from '../src/index';

/**
 * The learning outcome workbook.
 *
 * Opens the file it produced and reads the cells back, so a workbook
 * that is well formed but blank cannot pass. The figures are the
 * engine's, verified in the engine's own tests; what is checked here is
 * that they reach the right cells and that a formula's cached result
 * agrees with the engine — a divergence would show a reader one number
 * and give a consumer another.
 */

const LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'];

function fixture(): LearningOutcomeInput {
  const questions = [
    { id: 'q1', label: 'Q1', level: 'Remember', maxMark: 10 },
    { id: 'q2', label: 'Q2', level: 'Apply', maxMark: 20 },
    { id: 'q3', label: 'Q3', level: 'Analyse', maxMark: 20 },
  ];
  // Paper total 50. Remember 10 (20%), Apply 20 (40%), Analyse 20 (40%).
  const result = computeKnowledgeLevels({
    levels: LEVELS,
    items: questions.map((q) => ({ id: q.id, maxMark: q.maxMark, level: q.level })),
    // s1 sat it all; s2 skipped the analysis question; s3 sat nothing.
    marks: {
      s1: { q1: 8, q2: 16, q3: 10 },
      s2: { q1: 5, q2: 12, q3: null },
      s3: {},
    },
    studentIds: ['s1', 's2', 's3'],
    bands: DEFAULT_PARAMETERS.bands,
  });

  return {
    course: {
      code: 'MAT301',
      title: 'Real Analysis',
      programmeName: 'B.Sc. Mathematics',
      batchName: '2024-2027',
      departmentName: 'Mathematics',
    },
    assessment: { name: 'Internal Test I', taggedItems: 3, totalItems: 4 },
    questions,
    students: [
      { registerNumber: '24MAT001', fullName: 'A. Student' },
      { registerNumber: '24MAT002', fullName: 'B. Student' },
      { registerNumber: '24MAT003', fullName: 'C. Student' },
    ],
    result,
    generatedAt: new Date('2026-08-13T09:00:00Z'),
    engineVersion: '0.1.0',
  };
}

async function open(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/**
 * The cached result of a formula cell, or the literal value.
 *
 * exceljs drops a cached result of 0 when it writes the file (it treats
 * it as falsy), so a formula that computed 0 comes back with no cached
 * value at all. That is the library's behaviour, not this package's, and
 * it is harmless: Excel recalculates a formula with no cached value on
 * open, which was verified by opening a generated file in Excel — every
 * figure, including the zeroes, displayed the engine's number. `null`
 * here therefore means "0, or genuinely blank"; the tests below assert
 * the formula itself where that distinction matters.
 */
const valueOf = (cell: ExcelJS.Cell): unknown => {
  const v = cell.value;
  if (v !== null && typeof v === 'object' && 'formula' in v) return (v as ExcelJS.CellFormulaValue).result ?? null;
  return v;
};

const formulaOf = (cell: ExcelJS.Cell): string | null => {
  const v = cell.value;
  return v !== null && typeof v === 'object' && 'formula' in v ? (v as ExcelJS.CellFormulaValue).formula : null;
};

const findRow = (sheet: ExcelJS.Worksheet, label: string): number => {
  for (let r = 1; r <= sheet.rowCount; r++) {
    if (String(sheet.getCell(r, 1).value ?? '').trim() === label) return r;
  }
  throw new Error(`no row labelled '${label}' in ${sheet.name}`);
};

describe('the learning outcome workbook', () => {
  it('produces a real xlsx with the three sheets', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Expected (QP)', 'Attained - Students', 'Attained - Class']);
  });

  it('names the course and the paper it is about', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Expected (QP)')!;
    expect(String(sheet.getCell(2, 1).value)).toContain('MAT301');
    expect(String(sheet.getCell(4, 1).value)).toContain('Internal Test I');
    // The tagged/total count matters: a reader must know the paper total
    // below is not the whole paper.
    expect(String(sheet.getCell(4, 1).value)).toContain('3 of 4');
  });

  it('puts each question’s marks under its own knowledge level and nowhere else', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Expected (QP)')!;
    const header = 7;
    const levelColumn = (level: string) => {
      for (let c = 3; c < 3 + LEVELS.length; c++) if (sheet.getCell(header, c).value === level) return c;
      throw new Error(`no column for ${level}`);
    };

    // Q1 (Remember, 10) sits under Remember; every other level is blank.
    const q1Row = header + 1;
    expect(valueOf(sheet.getCell(q1Row, levelColumn('Remember')))).toBe(10);
    expect(valueOf(sheet.getCell(q1Row, levelColumn('Apply')))).toBeNull();
    expect(valueOf(sheet.getCell(q1Row, levelColumn('Analyse')))).toBeNull();
  });

  it('totals the marks per level and states the expected share', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Expected (QP)')!;
    const allotted = findRow(sheet, 'Total marks allotted');
    const expected = findRow(sheet, 'Expected learning outcome (%)');
    const header = 7;
    const col = (level: string) => {
      for (let c = 3; c < 3 + LEVELS.length; c++) if (sheet.getCell(header, c).value === level) return c;
      throw new Error(`no column for ${level}`);
    };

    // Remember 10 of 50 = 20%; Apply and Analyse 20 of 50 = 40% each.
    expect(valueOf(sheet.getCell(allotted, col('Remember')))).toBe(10);
    expect(valueOf(sheet.getCell(expected, col('Remember')))).toBeCloseTo(20, 10);
    expect(valueOf(sheet.getCell(expected, col('Apply')))).toBeCloseTo(40, 10);
    expect(valueOf(sheet.getCell(expected, col('Analyse')))).toBeCloseTo(40, 10);

    // A level the paper never examines still gets a cell that computes
    // its share — which is 0, a real finding rather than a gap. Asserted
    // through the formula because a cached 0 does not survive the write;
    // Excel recalculates it to 0.0 on open.
    expect(formulaOf(sheet.getCell(expected, col('Create')))).toMatch(/\/.*\*100/);
  });

  it('every formula’s cached result is the engine’s own figure', async () => {
    // The rule this package is built on. A formula whose cached value
    // disagreed with the engine would show a reader one number and hand
    // a consumer another.
    const data = fixture();
    const workbook = await open(await buildLearningOutcomeWorkbook(data));
    const sheet = workbook.getWorksheet('Expected (QP)')!;
    const expected = findRow(sheet, 'Expected learning outcome (%)');

    let compared = 0;
    for (const [i, row] of data.result.blueprint.entries()) {
      const cell = sheet.getCell(expected, 3 + i);
      // A zero is not carried through the write, so there is nothing to
      // compare — the formula is asserted separately above.
      if (row.expectedPercent === null || row.expectedPercent === 0) continue;
      expect(valueOf(cell) as number, row.level).toBeCloseTo(row.expectedPercent, 10);
      compared += 1;
    }
    // Guards the guard: if the sheet ever stopped caching results at all,
    // the loop above would silently compare nothing and still pass.
    expect(compared).toBeGreaterThan(0);
  });

  it('gives each student a row, with a level as a number rather than text', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Attained - Students')!;
    const row = findRow(sheet, '24MAT001');
    expect(sheet.getCell(row, 2).value).toBe('A. Student');

    // Remember is the first level pair: 8 of 10 = 80% → level 3.
    expect(valueOf(sheet.getCell(row, 3)) as number).toBeCloseTo(80, 10);
    const level = valueOf(sheet.getCell(row, 4));
    expect(level).toBe(3);
    // The source workbook writes "3" as text, which averages wrongly
    // against a numeric 2 (§9).
    expect(typeof level).toBe('number');
  });

  it('leaves an absent student blank rather than writing zeroes against their name', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Attained - Students')!;
    const row = findRow(sheet, '24MAT003');
    expect(valueOf(sheet.getCell(row, 3)) ?? null).toBeNull();
    expect(valueOf(sheet.getCell(row, 4)) ?? null).toBeNull();
    // …and says why, so the blanks are not read as missing data.
    const note = String(sheet.getCell(row, 3 + LEVELS.length * 2 + 1).value ?? '');
    expect(note).toContain('attempted nothing');
  });

  it('a student who left one question blank is still measured, and lower for it', async () => {
    const data = fixture();
    const workbook = await open(await buildLearningOutcomeWorkbook(data));
    const sheet = workbook.getWorksheet('Attained - Students')!;
    const row = findRow(sheet, '24MAT002');
    // Analyse: 0 of 20, because the blank stays in the denominator.
    const analyseCol = 3 + LEVELS.indexOf('Analyse') * 2;
    expect(valueOf(sheet.getCell(row, analyseCol)) as number).toBeCloseTo(0, 10);
    expect(valueOf(sheet.getCell(row, analyseCol + 1))).toBe(0);
  });

  it('reports the class with the absentee excluded', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Attained - Class')!;
    // Two present students; Remember (8 + 5) of 20 = 65% → level 2.
    const row = findRow(sheet, 'Remember');
    expect(valueOf(sheet.getCell(row, 4))).toBe(13);
    expect(valueOf(sheet.getCell(row, 5)) as number).toBeCloseTo(65, 10);
    expect(valueOf(sheet.getCell(row, 6))).toBe(2);
    expect(valueOf(sheet.getCell(row, 7))).toBe(2);

    expect(valueOf(sheet.getCell(findRow(sheet, 'Students counted'), 2))).toBe(2);
    expect(valueOf(sheet.getCell(findRow(sheet, 'Absent (attempted nothing)'), 2))).toBe(1);
  });

  it('carries the engine’s notes into the file', async () => {
    const workbook = await open(await buildLearningOutcomeWorkbook(fixture()));
    const sheet = workbook.getWorksheet('Attained - Class')!;
    const codes: string[] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const value = String(sheet.getCell(r, 1).value ?? '');
      if (value.startsWith('KL_')) codes.push(value);
    }
    expect(codes).toContain('KL_STUDENT_ABSENT');
    expect(codes).toContain('KL_MARKS_UNATTEMPTED');
  });

  it('survives a paper nobody sat', async () => {
    const data = fixture();
    data.result = computeKnowledgeLevels({
      levels: LEVELS,
      // The label serves as the id here: it is unique within an
      // assessment, and the workbook input carries no item ids.
      items: data.questions.map((q) => ({ id: q.label, maxMark: q.maxMark, level: q.level })),
      marks: {},
      studentIds: ['s1'],
      bands: DEFAULT_PARAMETERS.bands,
    });
    data.students = [{ registerNumber: '24MAT001', fullName: 'A. Student' }];
    const workbook = await open(await buildLearningOutcomeWorkbook(data));
    // The blueprint still stands — it never depended on a mark.
    const sheet = workbook.getWorksheet('Expected (QP)')!;
    expect(valueOf(sheet.getCell(findRow(sheet, 'Expected learning outcome (%)'), 3)) as number).toBeCloseTo(20, 10);
  });
});
