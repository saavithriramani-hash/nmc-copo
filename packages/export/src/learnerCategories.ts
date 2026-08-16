import ExcelJS from 'exceljs';
import type { CategoryBandRow, LearnerCategoryResult } from '@copo/engine';
import { address, ref, sanitizeSheetName, setFormula, setFormulaText, setHeader, setNote, setTitle, setValue } from './cells';

/**
 * The slow and advanced learner workbook (CR-8) — the college's NAAC
 * 2.2.1 identification, produced from the ratings entered and the marks
 * already in the ledger.
 *
 * FAITHFUL TO THE LAYOUT, NOT TO THE ARITHMETIC. The shape is the filed
 * workbook's: a sheet per subject with students down and criteria across,
 * then a semester sheet averaging each criterion across the subjects and
 * summing the averages into a score. Five things are deliberately not
 * reproduced, because each is a defect in the filed file:
 *
 * 1. `FinalSem1!I6` is `=SUM(D10+E10+F10+G10+H10)` — shared down to I18,
 *    so thirteen of seventeen students display the score of the student
 *    four rows below, and the two highest scorers in the semester are on
 *    file as slow learners. Here every reference is generated from the
 *    student's own row, and the cached result is the engine's figure for
 *    that student, so the two would have to be wrong in the same way to
 *    agree.
 * 2. The category is typed by hand there (84.6 appears as both "SL" and
 *    "AL" in one sheet). Here it is an IF chain built from the band table
 *    actually applied, printed on the sheet beside it.
 * 3. Formulas overtyped with literals (FinalSem2 rows 6-7). Every derived
 *    cell here is written as a formula, every time.
 * 4. One cell rounded and no other (`ROUND(...,0)` in FinalSem2!D22).
 *    Rounding is a display format here, never arithmetic.
 * 5. `=SUM(a+b)/2` counts a subject the student never took as a zero.
 *    AVERAGE is used instead, which skips blank and text cells — so a
 *    subject not taken, and a criterion not rated, both leave the divisor
 *    exactly as the engine's `ratedIn` does.
 *
 * The subject sheets are also named for their courses rather than
 * `Sheet1`…`Sheet5`: the filed file records which sheet is which semester
 * nowhere but inside the formulas that read them.
 */

export interface LearnerWorkbookInput {
  programme: { name: string; departmentName: string };
  batch: { name: string };
  semester: number;
  criteria: { id: string; label: string; maxScore: number; derived: boolean }[];
  courses: { id: string; code: string; title: string }[];
  /** Every student of the batch, in roster order — the row order of every sheet. */
  students: { studentId: string; registerNumber: string; fullName: string }[];
  /**
   * courseId → studentId → criterionId → score. A missing student means
   * not enrolled; a missing or null score means not rated. The two are
   * distinguished on the sheet and treated identically by AVERAGE.
   */
  scores: Record<string, Record<string, Record<string, number | null>>>;
  bands: CategoryBandRow[];
  bandSource: 'programme' | 'institution' | 'default';
  result: LearnerCategoryResult;
  generatedAt: Date;
  engineVersion: string;
}

const SUMMARY_SHEET = 'Summary';

/** Row 1 of the data on every subject sheet; A = register no., B = name. */
const FIRST_CRITERION_COL = 3;

export async function buildLearnerCategoryWorkbook(data: LearnerWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CO-PO Attainment';
  workbook.created = data.generatedAt;

  const taken = new Set<string>();
  // The subject sheets first, so the semester sheet can reference them,
  // then the semester sheet, then the summary that names nobody.
  const subjectSheets = data.courses.map((course) => ({
    course,
    name: sanitizeSheetName(`${course.code}`, taken),
  }));

  for (const { course, name } of subjectSheets) buildSubjectSheet(workbook, data, course, name);
  const semesterSheetName = sanitizeSheetName(`Semester ${data.semester}`, taken);
  buildSemesterSheet(workbook, data, subjectSheets, semesterSheetName);
  buildSummarySheet(workbook, data, sanitizeSheetName(SUMMARY_SHEET, taken));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function heading(sheet: ExcelJS.Worksheet, data: LearnerWorkbookInput, title: string, subtitle: string): number {
  setTitle(sheet, 1, title);
  setValue(sheet, 1, 2, `${data.programme.departmentName} · ${data.programme.name}`);
  setValue(sheet, 1, 3, `Batch ${data.batch.name} · Semester ${data.semester}`);
  setValue(sheet, 1, 4, subtitle);
  setNote(sheet, 5, `Generated ${data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${data.engineVersion}`);
  return 7;
}

/**
 * One subject: students down, criteria across, every cell a literal.
 *
 * These are the inputs the semester sheet's formulas bottom out at. The
 * derived criterion is a literal here too — its arithmetic runs over the
 * mark ledger, which is not in this file, so a formula would be a
 * fiction. The note says so on the sheet.
 */
function buildSubjectSheet(
  workbook: ExcelJS.Workbook,
  data: LearnerWorkbookInput,
  course: { id: string; code: string; title: string },
  sheetName: string,
): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 30;
  data.criteria.forEach((_, i) => (sheet.getColumn(FIRST_CRITERION_COL + i).width = 16));

  let row = heading(sheet, data, `${course.code} — ${course.title}`, 'Ratings entered for this subject');
  setHeader(sheet, row, [
    'Register no.',
    'Name',
    ...data.criteria.map((c) => `${c.label} (${c.maxScore})`),
  ]);
  row += 1;

  const courseScores = data.scores[course.id] ?? {};
  for (const student of data.students) {
    setValue(sheet, 1, row, student.registerNumber);
    setValue(sheet, 2, row, student.fullName);
    const mine = courseScores[student.studentId];
    data.criteria.forEach((criterion, i) => {
      const col = FIRST_CRITERION_COL + i;
      if (mine === undefined) {
        // Not enrolled. Text rather than blank so a reader can tell it
        // from "enrolled but not yet rated" — and AVERAGE ignores text in
        // a referenced cell exactly as it ignores a blank, so the two
        // leave the divisor alike, which is what the engine does.
        setValue(sheet, col, row, '—');
      } else {
        const score = mine[criterion.id];
        // No number format: Excel's `0.##` renders a whole 20 as "20."
        // with a dangling point, and these are ratings a reader scans a
        // column of. General shows 20 and 15.5 as written.
        setValue(sheet, col, row, score === null || score === undefined ? null : score);
      }
    });
    row += 1;
  }

  row += 1;
  setNote(sheet, row, 'Blank = enrolled but not yet rated. “—” = not enrolled in this subject. Neither is a zero, and neither counts towards an average.');
  const derived = data.criteria.find((c) => c.derived);
  if (derived) {
    setNote(
      sheet,
      row + 1,
      `“${derived.label}” is derived from the mark ledger — total marks earned over the marks this subject’s papers allot, scaled to ${derived.maxScore} — and is not typed by anyone. It appears here as a value because the marks it comes from are not in this file.`,
    );
  }
}

/**
 * The semester: each criterion averaged across the subject sheets, the
 * averages summed, the category looked up. Every cell here is a formula.
 */
function buildSemesterSheet(
  workbook: ExcelJS.Workbook,
  data: LearnerWorkbookInput,
  subjectSheets: { course: { id: string }; name: string }[],
  sheetName: string,
): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 30;

  let row = heading(
    sheet,
    data,
    `Slow and advanced learners — semester ${data.semester}`,
    `${subjectSheets.length} subject(s): ${data.courses.map((c) => c.code).join(', ') || '—'}`,
  );

  const criteriaCols = data.criteria.map((_, i) => FIRST_CRITERION_COL + i);
  /** The columns a PERSON judges — the derived weightage is not one. */
  const judgedCols = criteriaCols.filter((_, i) => !data.criteria[i]!.derived);
  const subjectsCol = FIRST_CRITERION_COL + data.criteria.length;
  const judgedCol = subjectsCol + 1;
  const totalCol = judgedCol + 1;
  const obtainableCol = totalCol + 1;
  const percentCol = obtainableCol + 1;
  const categoryCol = percentCol + 1;
  for (const col of [...criteriaCols, subjectsCol, judgedCol, totalCol, obtainableCol, percentCol]) {
    sheet.getColumn(col).width = 14;
  }
  sheet.getColumn(categoryCol).width = 16;

  setHeader(sheet, row, [
    'Register no.',
    'Name',
    ...data.criteria.map((c) => c.label),
    'Subjects',
    'Judged on',
    'Final score',
    'Out of',
    '%',
    'Category',
  ]);
  row += 1;

  // The band table is written into the sheet and the category formula
  // reads it, so the rule is visible and a reader can change it and watch
  // every category move — instead of the filed sheet's typed label.
  const sorted = [...data.bands].sort((a, b) => b.lowerPercent - a.lowerPercent);
  const firstDataRow = row;

  for (const [index, student] of data.result.students.entries()) {
    const who = data.students[index];
    setValue(sheet, 1, row, who?.registerNumber ?? '');
    setValue(sheet, 2, row, who?.fullName ?? '');

    data.criteria.forEach((_, i) => {
      const col = criteriaCols[i]!;
      // Generated from THIS student's row on every subject sheet. The
      // filed workbook's shared formula pointed four rows down; there is
      // nothing to shift here, and the cached result is the engine's
      // figure for this student, so a slip would show up as a
      // disagreement rather than as a plausible wrong number.
      const args = subjectSheets.map((s) => ref(s.name, col, row)).join(',');
      setFormula(
        sheet,
        col,
        row,
        // AVERAGE, never SUM(...)/n: it skips the subjects this student
        // did not take and the criteria nobody rated, which is fault 5.
        subjectSheets.length > 0 ? `IF(COUNT(${args})=0,"",AVERAGE(${args}))` : '""',
        student.perCriterion[i]?.mean ?? null,
        '0.00',
      );
    });

    setValue(sheet, subjectsCol, row, student.coursesTaken);

    // How many criteria a person has judged this student on. A formula,
    // so a reader can see it move as the sheet is filled in, and so the
    // category below it cannot be computed without it.
    setFormula(
      sheet,
      judgedCol,
      row,
      judgedCols.length > 0 ? `COUNT(${judgedCols.map((col) => address(col, row)).join(',')})` : '0',
      student.judgedCriteria,
    );

    const firstCol = criteriaCols[0] ?? FIRST_CRITERION_COL;
    const lastCol = criteriaCols[criteriaCols.length - 1] ?? FIRST_CRITERION_COL;
    setFormula(
      sheet,
      totalCol,
      row,
      criteriaCols.length > 0 ? `SUM(${address(firstCol, row)}:${address(lastCol, row)})` : '0',
      student.totalScore,
      '0.00',
    );
    // Obtainable counts only the criteria this student has a mean for, so
    // a partly rated student is scored out of what was rated. A literal:
    // it is a property of which cells above are non-empty, and spelling
    // that out in Excel would obscure rather than reveal.
    setValue(sheet, obtainableCol, row, student.obtainableScore);
    setFormula(
      sheet,
      percentCol,
      row,
      `IF(OR(${address(obtainableCol, row)}=0,${address(totalCol, row)}=""),"",${address(totalCol, row)}/${address(obtainableCol, row)}*100)`,
      student.finalPercent,
      '0.0',
    );
    setFormulaText(
      sheet,
      categoryCol,
      row,
      categoryFormula(
        address(percentCol, row),
        // The gate, and it matters: without it Excel recalculates the band
        // chain on open and cheerfully labels every student the engine
        // left unclassified — a student with marks and no judgement came
        // out as "Average". The file would then disagree with the
        // application the moment anybody opened it, which is exactly what
        // this package exists to prevent.
        judgedCols.length > 0 ? address(judgedCol, row) : null,
        sorted,
      ),
      student.category,
    );
    row += 1;
  }

  const lastDataRow = row - 1;
  row += 1;

  setTitle(sheet, row, 'The rule');
  row += 1;
  setHeader(sheet, row, ['Category', 'Score at least (%)']);
  row += 1;
  for (const band of sorted) {
    setValue(sheet, 1, row, band.category);
    setValue(sheet, 2, row, band.lowerPercent);
    row += 1;
  }
  row += 1;
  setNote(
    sheet,
    row,
    `Band table ${
      data.bandSource === 'programme'
        ? 'set for this programme'
        : data.bandSource === 'institution'
          ? 'inherited from the institution'
          : 'built in — nothing is configured, so the default applies'
    }.`,
  );
  setNote(sheet, row + 1, 'Each criterion is averaged over the subjects in which it was rated, never over the subjects taken: AVERAGE skips blanks, so a subject not taken and a criterion not rated both leave the divisor.');
  setNote(sheet, row + 2, 'A student with no rating anywhere is left blank and unclassified. That is not the same as a slow learner, and the two must never be filed as one.');
  setNote(
    sheet,
    row + 3,
    '“Judged on” counts the criteria a teacher has judged; the mark-derived one does not count towards it. A student judged on none stays blank, however good their marks: a category resting on the marks alone would be a mark percentage wearing a category name.',
  );
  if (lastDataRow >= firstDataRow) {
    setNote(sheet, row + 4, `Every figure in rows ${firstDataRow}–${lastDataRow} is computed from that student’s own row on the subject sheets.`);
  }
}

/**
 * The band table as a nested IF, highest band first — gated on a person
 * having judged the student.
 *
 * `judgedRef` is null only when the programme has no judged criterion at
 * all, i.e. it asked for a purely computed classification and gets one.
 */
function categoryFormula(percentRef: string, judgedRef: string | null, sorted: CategoryBandRow[]): string {
  if (sorted.length === 0) return '""';
  let formula = '""';
  // Built from the bottom up so the highest band ends outermost and wins,
  // which is the inclusive-boundary rule the engine applies.
  for (let i = sorted.length - 1; i >= 0; i--) {
    const band = sorted[i]!;
    formula = `IF(${percentRef}>=${band.lowerPercent},"${band.category.replace(/"/g, '""')}",${formula})`;
  }
  const banded = `IF(${percentRef}="","",${formula})`;
  return judgedRef === null ? banded : `IF(${judgedRef}=0,"",${banded})`;
}

/** The counts — the figure an accreditation return files. Names nobody. */
function buildSummarySheet(workbook: ExcelJS.Workbook, data: LearnerWorkbookInput, sheetName: string): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 60;

  let row = heading(sheet, data, 'Slow and advanced learners — summary', 'Counts only; no student is named on this sheet.');
  setHeader(sheet, row, ['Category', 'Students', 'Share (%)']);
  row += 1;

  const firstRow = row;
  for (const count of data.result.counts) {
    setValue(sheet, 1, row, count.category);
    setValue(sheet, 2, row, count.students);
    setValue(sheet, 3, row, count.percent, '0.0');
    row += 1;
  }
  const lastRow = row - 1;

  setValue(sheet, 1, row, 'Classified');
  if (lastRow >= firstRow) {
    setFormula(
      sheet,
      2,
      row,
      `SUM(${address(2, firstRow)}:${address(2, lastRow)})`,
      data.result.students.length - data.result.unclassifiedStudentIds.length,
    );
  }
  row += 1;
  setValue(sheet, 1, row, 'Not yet rated (excluded from the shares)');
  setValue(sheet, 2, row, data.result.unclassifiedStudentIds.length);
  row += 1;
  setValue(sheet, 1, row, 'Students on the roll');
  setValue(sheet, 2, row, data.result.students.length);
  row += 2;

  setNote(sheet, row, 'Shares are of the students actually classified, not of the roll: a half-filled sheet must not report a cohort as mostly slow learners.');
  row += 2;

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
