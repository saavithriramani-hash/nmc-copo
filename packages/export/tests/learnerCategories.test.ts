import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { computeLearnerCategories, DEFAULT_CATEGORY_BANDS, type LearnerCourseRatings } from '@copo/engine';
import { buildLearnerCategoryWorkbook, type LearnerWorkbookInput } from '../src/learnerCategories';

/**
 * The slow and advanced learner workbook (CR-8).
 *
 * The figures are the engine's, re-derived here by hand where they are
 * asserted. What these tests are really for is the FILE: that the
 * semester sheet's formulas point at the right student's row, that
 * blank is not zero on the way through, and that the category is a
 * stated rule rather than a typed word — the three ways the college's
 * own workbook goes wrong.
 */

const CRITERIA = [
  { id: 'c1', label: 'Interaction with teachers', maxScore: 20, derived: false },
  { id: 'c2', label: 'Flipped learning', maxScore: 20, derived: false },
  { id: 'c3', label: 'Weightage — CIA & semester', maxScore: 20, derived: true },
];

const STUDENTS = [
  { studentId: 's1', registerNumber: 'U23MAT001', fullName: 'ALPHA A' },
  { studentId: 's2', registerNumber: 'U23MAT002', fullName: 'BETA B' },
  { studentId: 's3', registerNumber: 'U23MAT003', fullName: 'GAMMA G' },
];

const COURSES = [
  { id: 'algebra', code: 'U23MAT101', title: 'Algebra and Trigonometry' },
  { id: 'calculus', code: 'U23MAT102', title: 'Differential Calculus' },
];

/**
 * s1 sits both subjects and does well; s2 sits both and does poorly; s3
 * sits only Algebra, and is unrated on one criterion there.
 *
 * By hand — s1: c1 (18+14)/2 = 16, c2 (20+16)/2 = 18, c3 (17+11)/2 = 14
 * → 48 of 60 = 80% → Advanced.
 * s2: c1 (10+8)/2 = 9, c2 (12+10)/2 = 11, c3 (9+7)/2 = 8 → 28 of 60
 * = 46.67% → Slow.
 * s3: c1 15 (one subject), c2 not rated anywhere, c3 13 → 28 of 40 = 70%
 * → Average, and partly rated.
 */
const SCORES: Record<string, Record<string, Record<string, number | null>>> = {
  algebra: {
    s1: { c1: 18, c2: 20, c3: 17 },
    s2: { c1: 10, c2: 12, c3: 9 },
    s3: { c1: 15, c2: null, c3: 13 },
  },
  calculus: {
    s1: { c1: 14, c2: 16, c3: 11 },
    s2: { c1: 8, c2: 10, c3: 7 },
    // s3 is absent from this map entirely: not enrolled.
  },
};

function engineResult(scores = SCORES) {
  const courses: LearnerCourseRatings[] = COURSES.map((course) => ({
    courseId: course.id,
    courseTitle: `${course.code} ${course.title}`,
    studentIds: Object.keys(scores[course.id] ?? {}),
    scores: scores[course.id] ?? {},
  }));
  return computeLearnerCategories({
    criteria: CRITERIA,
    courses,
    studentIds: STUDENTS.map((s) => s.studentId),
    bands: [...DEFAULT_CATEGORY_BANDS],
  });
}

function input(over: Partial<LearnerWorkbookInput> = {}): LearnerWorkbookInput {
  return {
    programme: { name: 'B.Sc. Mathematics', departmentName: 'Department of Mathematics' },
    batch: { name: '2023-2026' },
    semester: 1,
    criteria: CRITERIA,
    courses: COURSES,
    students: STUDENTS,
    scores: SCORES,
    bands: [...DEFAULT_CATEGORY_BANDS],
    bandSource: 'default',
    result: engineResult(),
    generatedAt: new Date('2026-08-16T09:00:00Z'),
    engineVersion: '0.1.0',
    ...over,
  };
}

async function open(data = input()): Promise<ExcelJS.Workbook> {
  const buffer = await buildLearnerCategoryWorkbook(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

const cell = (sheet: ExcelJS.Worksheet, address: string) => sheet.getCell(address).value;
const formulaOf = (sheet: ExcelJS.Worksheet, address: string): string => {
  const value = sheet.getCell(address).value;
  if (value && typeof value === 'object' && 'formula' in value) return (value as ExcelJS.CellFormulaValue).formula;
  throw new Error(`${address} is not a formula: ${JSON.stringify(value)}`);
};
const resultOf = (sheet: ExcelJS.Worksheet, address: string): unknown => {
  const value = sheet.getCell(address).value;
  // A formula with no cached result reads as undefined, not as the
  // formula object — that is what "the engine had nothing to put here"
  // looks like in the file.
  if (value && typeof value === 'object' && 'formula' in value) return (value as ExcelJS.CellFormulaValue).result;
  return value;
};

/** Row of a student on any sheet: header block is 7 rows, then the header. */
const rowOf = (index: number) => 8 + index;

/**
 * Named columns of the semester sheet, so adding one to the layout does
 * not require re-lettering every assertion below. With the three criteria
 * of this fixture: A register, B name, C-E criteria, then these.
 */
const COL = {
  c1: 'C',
  c2: 'D',
  c3: 'E',
  subjects: 'F',
  judged: 'G',
  total: 'H',
  obtainable: 'I',
  percent: 'J',
  category: 'K',
} as const;

describe('the sheets', () => {
  it('gives every subject its own sheet, named for the course', async () => {
    const workbook = await open();
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'U23MAT101',
      'U23MAT102',
      'Semester 1',
      'Summary',
    ]);
  });

  it('lists the WHOLE roll on every subject sheet, in one order', async () => {
    // Not merely tidy: the semester sheet averages across the subject
    // sheets by row, so a student must sit on the same row everywhere.
    const workbook = await open();
    for (const name of ['U23MAT101', 'U23MAT102']) {
      const sheet = workbook.getWorksheet(name)!;
      expect(STUDENTS.map((_, i) => cell(sheet, `A${rowOf(i)}`))).toEqual([
        'U23MAT001',
        'U23MAT002',
        'U23MAT003',
      ]);
    }
  });
});

describe('blank, zero and not-enrolled stay three different things', () => {
  it('writes an unrated criterion as a genuinely empty cell', async () => {
    const sheet = (await open()).getWorksheet('U23MAT101')!;
    // s3 (row 3) was not rated on c2 (column D).
    const value = cell(sheet, `D${rowOf(2)}`);
    expect(value === null || value === undefined).toBe(true);
    expect(value).not.toBe(0);
  });

  it('marks a student who is not enrolled distinctly from one not rated', async () => {
    const sheet = (await open()).getWorksheet('U23MAT102')!;
    expect(cell(sheet, `C${rowOf(2)}`)).toBe('—');
  });

  it('keeps a rating of zero as a real zero', async () => {
    const scores = { ...SCORES, algebra: { ...SCORES.algebra, s1: { c1: 0, c2: 20, c3: 17 } } };
    const sheet = (await open(input({ scores, result: engineResult(scores) }))).getWorksheet('U23MAT101')!;
    // exceljs writes 0 as 0; what matters is that it is not empty.
    const value = cell(sheet, `C${rowOf(0)}`);
    expect(value === 0 || value === null).toBe(true);
    if (value === null) throw new Error('a rating of zero was written as blank');
  });
});

describe('the semester sheet — where the filed workbook goes wrong', () => {
  it("averages each criterion from the student's OWN row on every subject sheet", async () => {
    // Fault 1: FinalSem1!I6 is =SUM(D10+…) — the student four rows down.
    const sheet = (await open()).getWorksheet('Semester 1')!;
    for (const [index] of STUDENTS.entries()) {
      const row = rowOf(index);
      const formula = formulaOf(sheet, `C${row}`);
      expect(formula).toContain(`U23MAT101!$C$${row}`);
      expect(formula).toContain(`U23MAT102!$C$${row}`);
      // …and no other row of either sheet.
      const referenced = [...formula.matchAll(/\$C\$(\d+)/g)].map((m) => Number(m[1]));
      expect(new Set(referenced)).toEqual(new Set([row]));
    }
  });

  it('uses AVERAGE, so a subject not taken leaves the divisor', async () => {
    // Fault 5: =SUM(a+b)/2 counts an absent subject as a zero.
    const sheet = (await open()).getWorksheet('Semester 1')!;
    const formula = formulaOf(sheet, `C${rowOf(2)}`);
    expect(formula).toContain('AVERAGE(');
    expect(formula).not.toMatch(/\/\s*2/);
    // s3 sat one subject and scored 15 — the mean is 15, not 7.5.
    expect(resultOf(sheet, `C${rowOf(2)}`)).toBe(15);
  });

  it('carries the engine figures for every student', async () => {
    const sheet = (await open()).getWorksheet('Semester 1')!;
    // Worked by hand at the top of this file.
    expect(resultOf(sheet, `${COL.c1}${rowOf(0)}`)).toBe(16);
    expect(resultOf(sheet, `${COL.c2}${rowOf(0)}`)).toBe(18);
    expect(resultOf(sheet, `${COL.c3}${rowOf(0)}`)).toBe(14);
    expect(resultOf(sheet, `${COL.total}${rowOf(0)}`)).toBe(48);
    expect(resultOf(sheet, `${COL.obtainable}${rowOf(0)}`)).toBe(60);
    expect(resultOf(sheet, `${COL.percent}${rowOf(0)}`)).toBe(80);
  });

  it('scores a partly rated student out of what was rated', async () => {
    const sheet = (await open()).getWorksheet('Semester 1')!;
    expect(resultOf(sheet, `${COL.total}${rowOf(2)}`)).toBe(28); // 15 + 13
    expect(resultOf(sheet, `${COL.obtainable}${rowOf(2)}`)).toBe(40); // NOT 60
    expect(resultOf(sheet, `${COL.percent}${rowOf(2)}`)).toBe(70);
  });

  it('derives the category from a stated rule, not a typed word', async () => {
    // Fault 2: the filed sheet types "SL"/"AL" by hand, and gives 84.6
    // both labels in one file.
    const sheet = (await open()).getWorksheet('Semester 1')!;
    const formula = formulaOf(sheet, `${COL.category}${rowOf(0)}`);
    expect(formula).toContain('>=75');
    expect(formula).toContain('Advanced');
    expect(formula).toContain(`${COL.percent}${rowOf(0)}`);
    expect(resultOf(sheet, `${COL.category}${rowOf(0)}`)).toBe('Advanced');
    expect(resultOf(sheet, `${COL.category}${rowOf(1)}`)).toBe('Slow');
    expect(resultOf(sheet, `${COL.category}${rowOf(2)}`)).toBe('Average');
  });

  it('gives the same score the same category, wherever it appears', async () => {
    // The filed sheet's 84.6 is "AL" on one row and "SL" on another.
    // Two students on an identical score must produce an identical
    // formula, so the file cannot disagree with itself.
    const scores = {
      algebra: {
        s1: { c1: 16, c2: 16, c3: 16 },
        s2: { c1: 16, c2: 16, c3: 16 },
        s3: { c1: 16, c2: 16, c3: 16 },
      },
      calculus: {},
    };
    const sheet = (await open(input({ scores, result: engineResult(scores) }))).getWorksheet('Semester 1')!;
    const categories = STUDENTS.map((_, i) => resultOf(sheet, `${COL.category}${rowOf(i)}`));
    expect(new Set(categories).size).toBe(1);
    expect(categories[0]).toBe('Advanced'); // 48/60 = 80%
  });

  it('writes the band table onto the sheet it is applied on', async () => {
    const sheet = (await open()).getWorksheet('Semester 1')!;
    const text = JSON.stringify(sheet.getSheetValues());
    expect(text).toContain('The rule');
    expect(text).toContain('Advanced');
    expect(text).toContain('Average');
    expect(text).toContain('Slow');
  });

  it('rounds only for display, never in the arithmetic', async () => {
    // Fault 4: ROUND(...,0) on one cell and no other.
    const scores = {
      algebra: { s1: { c1: 15, c2: 15, c3: 15 } },
      calculus: { s1: { c1: 16, c2: 16, c3: 16 } },
    };
    const sheet = (await open(input({ scores, result: engineResult(scores) }))).getWorksheet('Semester 1')!;
    for (const column of [COL.c1, COL.c2, COL.c3, COL.total, COL.percent]) {
      expect(formulaOf(sheet, `${column}${rowOf(0)}`)).not.toContain('ROUND');
    }
    expect(resultOf(sheet, `${COL.c1}${rowOf(0)}`)).toBe(15.5);
  });

  it('will not let Excel classify a student the engine refused to', async () => {
    // Found by opening a generated file in Excel, not by any assertion
    // on the cached values: the category is a live IF chain, so Excel
    // RECALCULATES it on open. Without a gate it read the percentage —
    // which exists, because the mark-derived criterion always has a
    // value — and labelled a student "Average" whom no teacher had
    // judged. The file then disagreed with the application the moment
    // anybody opened it.
    const scores = {
      algebra: { s1: { c1: 18, c2: 18, c3: 18 }, s2: { c3: 13.7 }, s3: { c3: 11 } },
      calculus: {},
    };
    const result = engineResult(scores);
    expect(result.students[1]!.category).toBeNull(); // the engine's answer
    expect(result.students[1]!.finalPercent).toBeCloseTo(68.5, 6); // …despite a real percentage

    const sheet = (await open(input({ scores, result }))).getWorksheet('Semester 1')!;
    const formula = formulaOf(sheet, `${COL.category}${rowOf(1)}`);
    // The gate reads the "Judged on" column, not the percentage alone.
    expect(formula).toMatch(new RegExp(`^IF\\(${COL.judged}\\d+=0,""`));
    // And the judged count is itself a formula over the judged columns —
    // c3 is the derived one and must not be among them.
    expect(formulaOf(sheet, `${COL.judged}${rowOf(1)}`)).toBe(
      `COUNT(${COL.c1}${rowOf(1)},${COL.c2}${rowOf(1)})`,
    );
    // Asserted through the formula, not the cached value: exceljs drops a
    // cached result of 0 on write (see the package README), so this cell
    // arrives with none and Excel recalculates it — verified by opening a
    // generated file, where it reads 0 and the category stays blank.
    expect(resultOf(sheet, `${COL.category}${rowOf(1)}`)).toBeUndefined();
    // The judged student is unaffected.
    expect(resultOf(sheet, `${COL.judged}${rowOf(0)}`)).toBe(2);
    expect(resultOf(sheet, `${COL.category}${rowOf(0)}`)).toBe('Advanced');
  });

  it('drops the gate when a programme judges nothing and asks for a computed classification', async () => {
    const criteria = [{ id: 'c3', label: 'Weightage', maxScore: 20, derived: true }];
    const scores = { algebra: { s1: { c3: 16 } }, calculus: {} };
    const result = computeLearnerCategories({
      criteria,
      courses: [{ courseId: 'algebra', courseTitle: 'A', studentIds: ['s1'], scores: scores.algebra }],
      studentIds: STUDENTS.map((s) => s.studentId),
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    const sheet = (await open(input({ criteria, scores, result }))).getWorksheet('Semester 1')!;
    // One criterion, so the layout is C = it, D Subjects, E Judged on,
    // F Final score, G Out of, H %, I Category.
    const formula = formulaOf(sheet, `I${rowOf(0)}`);
    expect(formula).not.toMatch(/^IF\(E\d+=0/);
    expect(resultOf(sheet, `I${rowOf(0)}`)).toBe('Advanced');
  });

  it('leaves an unclassified student blank rather than calling them slow', async () => {
    const scores = { algebra: { s1: { c1: 18, c2: 18, c3: 18 } }, calculus: {} };
    const sheet = (await open(input({ scores, result: engineResult(scores) }))).getWorksheet('Semester 1')!;
    // s2 and s3 have no rating anywhere.
    expect(resultOf(sheet, `${COL.category}${rowOf(1)}`)).toBeUndefined();
    expect(resultOf(sheet, `${COL.category}${rowOf(2)}`)).toBeUndefined();
    expect(resultOf(sheet, `${COL.category}${rowOf(0)}`)).toBe('Advanced');
  });
});

describe('the summary', () => {
  it('reports the counts and names nobody', async () => {
    const workbook = await open();
    const sheet = workbook.getWorksheet('Summary')!;
    const text = JSON.stringify(sheet.getSheetValues());
    for (const student of STUDENTS) {
      expect(text).not.toContain(student.registerNumber);
      expect(text).not.toContain(student.fullName);
    }
    expect(text).toContain('Advanced');
  });

  it('shares are of the classified, not of the roll', async () => {
    const scores = { algebra: { s1: { c1: 18, c2: 18, c3: 18 } }, calculus: {} };
    const workbook = await open(input({ scores, result: engineResult(scores) }));
    const sheet = workbook.getWorksheet('Summary')!;
    const values = JSON.stringify(sheet.getSheetValues());
    // One classified of three on the roll: the Advanced share is 100%,
    // not 33.3%.
    expect(values).toContain('100');
    expect(values).toContain('Not yet rated');
  });

  it('carries EVERY engine warning, whatever they are', async () => {
    const scores = { algebra: { s1: { c1: 18, c2: 18, c3: 18 } }, calculus: {} };
    const result = engineResult(scores);
    const workbook = await open(input({ scores, result }));
    const text = JSON.stringify(workbook.getWorksheet('Summary')!.getSheetValues());
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const warning of result.warnings) expect(text).toContain(warning.code);
  });

  it('carries the note that a student was left unclassified for want of a judgement', async () => {
    // The state every cohort is in before a teacher opens the sheet:
    // the marks are loaded, so the derived criterion has a value and
    // nothing else does.
    const scores = {
      algebra: { s1: { c1: 18, c2: 18, c3: 18 }, s2: { c3: 12 }, s3: { c3: 11 } },
      calculus: {},
    };
    const result = engineResult(scores);
    const workbook = await open(input({ scores, result }));
    const text = JSON.stringify(workbook.getWorksheet('Summary')!.getSheetValues());
    expect(text).toContain('LC_NOT_JUDGED');
    // …and those students are counted apart from the classified ones.
    expect(result.counts.reduce((n, c) => n + c.students, 0)).toBe(1);
  });
});

describe('degenerate shapes produce a file, never a crash', () => {
  it('a semester with no subjects', async () => {
    const result = computeLearnerCategories({
      criteria: CRITERIA,
      courses: [],
      studentIds: STUDENTS.map((s) => s.studentId),
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    const workbook = await open(input({ courses: [], scores: {}, result }));
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Semester 1', 'Summary']);
  });

  it('a programme with no criteria', async () => {
    const result = computeLearnerCategories({
      criteria: [],
      courses: [],
      studentIds: [],
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    const workbook = await open(input({ criteria: [], courses: [], students: [], scores: {}, result }));
    expect(workbook.getWorksheet('Summary')).toBeDefined();
  });

  it('an empty roll', async () => {
    const result = computeLearnerCategories({
      criteria: CRITERIA,
      courses: [],
      studentIds: [],
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    const workbook = await open(input({ students: [], courses: [], scores: {}, result }));
    expect(workbook.getWorksheet('Semester 1')).toBeDefined();
  });

  it('two subjects whose codes collide once sanitised', async () => {
    const courses = [
      { id: 'a', code: 'U23/MAT:101', title: 'One' },
      { id: 'b', code: 'U23 MAT 101', title: 'Two' },
    ];
    const workbook = await open(input({ courses, scores: {}, result: engineResult({}) }));
    const names = workbook.worksheets.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('a department that keeps its own scheme', () => {
  it('honours a two-category band table', async () => {
    const bands = [
      { lowerPercent: 70, category: 'AL' },
      { lowerPercent: 0, category: 'SL' },
    ];
    const result = computeLearnerCategories({
      criteria: CRITERIA,
      courses: COURSES.map((course) => ({
        courseId: course.id,
        courseTitle: course.code,
        studentIds: Object.keys(SCORES[course.id] ?? {}),
        scores: SCORES[course.id] ?? {},
      })),
      studentIds: STUDENTS.map((s) => s.studentId),
      bands,
    });
    const sheet = (await open(input({ bands, bandSource: 'programme', result }))).getWorksheet('Semester 1')!;
    expect(resultOf(sheet, `${COL.category}${rowOf(0)}`)).toBe('AL'); // 80%
    expect(resultOf(sheet, `${COL.category}${rowOf(2)}`)).toBe('AL'); // 70%, exactly on
    expect(resultOf(sheet, `${COL.category}${rowOf(1)}`)).toBe('SL'); // 46.7%
    expect(formulaOf(sheet, `${COL.category}${rowOf(0)}`)).toContain('>=70');
  });

  it('says which band table was applied', async () => {
    const sheet = (await open(input({ bandSource: 'institution' }))).getWorksheet('Semester 1')!;
    expect(JSON.stringify(sheet.getSheetValues())).toContain('inherited from the institution');
  });
});
