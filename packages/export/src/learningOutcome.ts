import ExcelJS from 'exceljs';
import type { KnowledgeLevelResult } from '@copo/engine';
import { address, setFormula, setHeader, setNote, setTitle, setValue } from './cells';

/**
 * The learning outcome workbook (CR-7) — the college's "Expected (QP) and
 * Actual" sheets, produced from the marks already entered.
 *
 * FAITHFUL WHERE IT MATTERS, DIFFERENT WHERE IT HELPS. The first sheet
 * reproduces the college's blueprint exactly: questions down, knowledge
 * levels across, each question's marks sitting in its own level's
 * column, totalled into an expected share of the paper. The college's
 * second sheet is one student per file — a "personal copy" — which for a
 * class of forty is forty files. The same figures are laid out here as
 * one table, a student per row, with the class beneath.
 *
 * Following this package's rule, every derived number is written as a
 * FORMULA whose cached result is the engine's own value: the reader sees
 * the arithmetic, and the number shown is the one the engine computed.
 * That is also the correction to the source workbook, whose attainment
 * level is an IF chain returning the TEXT "3" and awarding it to 79.5%.
 */

export interface LearningOutcomeInput {
  course: { code: string; title: string; programmeName: string; batchName: string; departmentName: string };
  assessment: { name: string; taggedItems: number; totalItems: number };
  /** Question label and level, in paper order. */
  questions: { label: string; level: string; maxMark: number }[];
  students: { registerNumber: string; fullName: string }[];
  result: KnowledgeLevelResult;
  generatedAt: Date;
  engineVersion: string;
}

const SHEET = {
  expected: 'Expected (QP)',
  students: 'Attained - Students',
  cohort: 'Attained - Class',
} as const;

export async function buildLearningOutcomeWorkbook(data: LearningOutcomeInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CO-PO Attainment';
  workbook.created = data.generatedAt;

  const levels = data.result.blueprint.map((row) => row.level);
  buildExpectedSheet(workbook, data, levels);
  buildStudentsSheet(workbook, data, levels);
  buildCohortSheet(workbook, data, levels);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Column of the first knowledge level; A holds the question, B its level. */
const FIRST_LEVEL_COL = 3;

function heading(sheet: ExcelJS.Worksheet, data: LearningOutcomeInput, title: string): number {
  setTitle(sheet, 1, title);
  setValue(sheet, 1, 2, `${data.course.code} — ${data.course.title}`);
  setValue(sheet, 1, 3, `${data.course.departmentName} · ${data.course.programmeName} · ${data.course.batchName}`);
  setValue(sheet, 1, 4, `${data.assessment.name} · ${data.assessment.taggedItems} of ${data.assessment.totalItems} question(s) tagged`);
  setNote(sheet, 5, `Generated ${data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${data.engineVersion}`);
  return 7;
}

/** Sheet 1: the paper's own design — no mark is involved. */
function buildExpectedSheet(workbook: ExcelJS.Workbook, data: LearningOutcomeInput, levels: string[]): void {
  const sheet = workbook.addWorksheet(SHEET.expected);
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 16;
  levels.forEach((_, i) => (sheet.getColumn(FIRST_LEVEL_COL + i).width = 14));
  const totalCol = FIRST_LEVEL_COL + levels.length;
  sheet.getColumn(totalCol).width = 10;

  let row = heading(sheet, data, 'Expected Learning Outcome — question paper');
  setHeader(sheet, row, ['Q.No', 'CO / unit', ...levels, 'Total']);
  const headerRow = row;
  row += 1;

  const firstQuestionRow = row;
  for (const question of data.questions) {
    setValue(sheet, 1, row, question.label);
    setValue(sheet, 2, row, question.level);
    levels.forEach((level, i) => {
      // The mark sits under its own level and nowhere else — the shape
      // of the college's blueprint, and what makes the column totals
      // mean what they say.
      setValue(sheet, FIRST_LEVEL_COL + i, row, level === question.level ? question.maxMark : null);
    });
    setFormula(
      sheet,
      totalCol,
      row,
      `SUM(${address(FIRST_LEVEL_COL, row)}:${address(FIRST_LEVEL_COL + levels.length - 1, row)})`,
      question.maxMark,
    );
    row += 1;
  }
  const lastQuestionRow = row - 1;

  // Marks allotted per level.
  const allottedRow = row;
  setValue(sheet, 1, allottedRow, 'Total marks allotted');
  sheet.getCell(allottedRow, 1).font = { bold: true };
  levels.forEach((_, i) => {
    const col = FIRST_LEVEL_COL + i;
    const blueprint = data.result.blueprint[i]!;
    setFormula(
      sheet,
      col,
      allottedRow,
      data.questions.length > 0 ? `SUM(${address(col, firstQuestionRow)}:${address(col, lastQuestionRow)})` : '0',
      blueprint.marksAllotted,
    );
  });
  setFormula(
    sheet,
    totalCol,
    allottedRow,
    `SUM(${address(FIRST_LEVEL_COL, allottedRow)}:${address(FIRST_LEVEL_COL + levels.length - 1, allottedRow)})`,
    data.result.paperTotal,
  );
  row += 1;

  // The expected share of the paper.
  const expectedRow = row;
  setValue(sheet, 1, expectedRow, 'Expected learning outcome (%)');
  sheet.getCell(expectedRow, 1).font = { bold: true };
  levels.forEach((_, i) => {
    const col = FIRST_LEVEL_COL + i;
    setFormula(
      sheet,
      col,
      expectedRow,
      `IF(${address(totalCol, allottedRow)}=0,"",${address(col, allottedRow)}/${address(totalCol, allottedRow)}*100)`,
      data.result.blueprint[i]!.expectedPercent,
      '0.0',
    );
  });
  setValue(sheet, totalCol, expectedRow, data.result.paperTotal > 0 ? 100 : null, '0.0');
  row += 2;

  setNote(sheet, row, 'The share of the paper that asks the student to do each thing. Derived from the paper alone — no mark is involved.');
  setNote(sheet, row + 1, `Guarded against an empty paper: a level examined by no question shows 0%, and a paper with no tagged question shows blank rather than a division by zero.`);
  sheet.getCell(headerRow, 1).alignment = { vertical: 'middle' };
}

/** Sheet 2: a student per row — the college's per-student sheet, gathered. */
function buildStudentsSheet(workbook: ExcelJS.Workbook, data: LearningOutcomeInput, levels: string[]): void {
  const sheet = workbook.addWorksheet(SHEET.students);
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 30;

  let row = heading(sheet, data, 'Learning outcome attained — each student');

  // Two header rows: the level spans a pair of columns (% and level).
  const levelHeaderRow = row;
  setHeader(sheet, levelHeaderRow, ['Register no.', 'Name']);
  levels.forEach((level, i) => {
    const col = 3 + i * 2;
    setHeader(sheet, levelHeaderRow, [level, ''], col);
    sheet.mergeCells(levelHeaderRow, col, levelHeaderRow, col + 1);
    sheet.getColumn(col).width = 10;
    sheet.getColumn(col + 1).width = 8;
  });
  const overallCol = 3 + levels.length * 2;
  setHeader(sheet, levelHeaderRow, ['Overall'], overallCol);
  sheet.getColumn(overallCol).width = 10;

  row += 1;
  setHeader(sheet, row, ['', '']);
  levels.forEach((_, i) => setHeader(sheet, row, ['%', 'Level'], 3 + i * 2));
  setHeader(sheet, row, ['%'], overallCol);
  row += 1;

  for (const [index, student] of data.result.students.entries()) {
    const who = data.students[index];
    setValue(sheet, 1, row, who?.registerNumber ?? '');
    setValue(sheet, 2, row, who?.fullName ?? '');

    student.perLevel.forEach((levelRow, i) => {
      const col = 3 + i * 2;
      // An absent student is blank, not 0: they did not attain nothing,
      // they sat nothing. The distinction survives into the file.
      setValue(sheet, col, row, student.absent ? null : levelRow.attainedPercent, '0.0');
      setValue(sheet, col + 1, row, student.absent ? null : levelRow.attainmentLevel);
    });
    setValue(sheet, overallCol, row, student.overallPercent, '0.0');
    if (student.absent) {
      setValue(sheet, overallCol + 1, row, 'attempted nothing');
      sheet.getCell(row, overallCol + 1).font = { italic: true, size: 9, color: { argb: 'FF999999' } };
    }
    row += 1;
  }

  row += 1;
  setNote(sheet, row, 'Marks earned as a share of the marks the paper allotted to each level. A question left blank stays in the denominator, as the college’s method requires.');
  setNote(sheet, row + 1, 'Attainment level from the same band table the course is graded against: 80% or more → 3, 60% → 2, 40% → 1, below 40% → 0. Written as a number, never as text.');
}

/** Sheet 3: the class — what accreditation files. */
function buildCohortSheet(workbook: ExcelJS.Workbook, data: LearningOutcomeInput, levels: string[]): void {
  const sheet = workbook.addWorksheet(SHEET.cohort);
  sheet.getColumn(1).width = 18;
  for (let col = 2; col <= 8; col++) sheet.getColumn(col).width = 14;

  let row = heading(sheet, data, 'Learning outcome attained — the class');
  setHeader(sheet, row, [
    'Knowledge level',
    'Expected %',
    'Marks allotted',
    'Marks earned',
    'Attained %',
    'Level',
    'Students',
    'At 0 / 1 / 2 / 3',
  ]);
  row += 1;

  data.result.cohort.forEach((cohortRow, i) => {
    const blueprint = data.result.blueprint[i]!;
    setValue(sheet, 1, row, cohortRow.level);
    setValue(sheet, 2, row, blueprint.expectedPercent, '0.0');
    setValue(sheet, 3, row, cohortRow.marksAllotted);
    setValue(sheet, 4, row, cohortRow.marksAwarded);
    setFormula(
      sheet,
      5,
      row,
      `IF(${address(3, row)}=0,"",${address(4, row)}/${address(3, row)}*100)`,
      cohortRow.attainedPercent,
      '0.0',
    );
    setValue(sheet, 6, row, cohortRow.attainmentLevel);
    setValue(sheet, 7, row, cohortRow.studentsCounted);
    const d = cohortRow.distribution;
    setValue(sheet, 8, row, `${d[0]} / ${d[1]} / ${d[2]} / ${d[3]}`);
    row += 1;
  });

  row += 1;
  setValue(sheet, 1, row, 'Students counted');
  setValue(sheet, 2, row, data.result.students.length - data.result.absentStudentIds.length);
  row += 1;
  setValue(sheet, 1, row, 'Absent (attempted nothing)');
  setValue(sheet, 2, row, data.result.absentStudentIds.length);
  row += 2;

  setNote(sheet, row, 'Counted over the whole class’s marks rather than as an average of student percentages, so a student who answered two questions does not weigh as much as one who sat the paper.');
  setNote(sheet, row + 1, 'Students who attempted nothing are excluded entirely: counting them would describe a class that nobody sat in.');
  row += 3;

  if (data.result.warnings.length > 0) {
    setTitle(sheet, row, 'Notes');
    row += 1;
    for (const warning of data.result.warnings) {
      setValue(sheet, 1, row, warning.code);
      setValue(sheet, 2, row, warning.message);
      row += 1;
    }
  }
}
