import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import {
  COURSE_IMPORT_HEADERS,
  MAX_COURSE_IMPORT_ROWS,
  batchLabel,
  canCommit,
  normaliseLabel,
  parseCourseRows,
  planCourseImport,
  type KnownBatch,
} from '../lib/courseImport';

// The template builder and the decoder are server-only modules; the
// guard package throws outside a server bundle, so it is stubbed here.
vi.mock('server-only', () => ({}));
const { buildCourseImportTemplateBuffer } = await import('../lib/courseImportTemplateFile');
const { decodeSpreadsheet } = await import('../lib/spreadsheet');

/** CR-11: bulk course import. Synthetic fixtures only. */

const MATH_2025 = 'Mathematics · B.Sc. Mathematics · 2025–2028';
const PHYS_2025 = 'Physics · B.Sc. Physics · 2025–2028';
const BATCHES: KnownBatch[] = [
  { id: 'b-math-2025', label: MATH_2025, departmentId: 'd-math' },
  { id: 'b-phys-2025', label: PHYS_2025, departmentId: 'd-phys' },
];
const HEADER = [...COURSE_IMPORT_HEADERS];

const parse = (...rows: string[][]) => parseCourseRows([HEADER, ...rows]);
const only = (...cells: string[]) => parse(cells);

describe('the batch label', () => {
  it('names a batch by department, programme and batch', () => {
    expect(batchLabel({ departmentName: 'Mathematics', programmeName: 'B.Sc. Mathematics', batchName: '2025–2028' })).toBe(
      MATH_2025,
    );
  });

  it('matches regardless of case and spacing around the separator', () => {
    expect(normaliseLabel('mathematics·B.Sc.  Mathematics ·2025–2028 ')).toBe(normaliseLabel(MATH_2025));
  });
});

describe('reading rows', () => {
  it('reads a full row', () => {
    const result = only(MATH_2025, 'MA101', 'Algebra', '1', '4', 'No');
    expect(result.errors).toEqual([]);
    expect(result.headerDetected).toBe(true);
    expect(result.rows).toEqual([
      { sourceRow: 2, batchLabel: MATH_2025, code: 'MA101', title: 'Algebra', semester: 1, credits: '4', isLaboratory: false },
    ]);
  });

  it('finds columns by header name, in any order', () => {
    const result = parseCourseRows([
      ['Title', 'Semester', 'Course code', 'Batch'],
      ['Algebra', '2', 'MA201', MATH_2025],
    ]);
    expect(result.rows[0]).toMatchObject({ code: 'MA201', title: 'Algebra', semester: 2, credits: null, isLaboratory: false });
  });

  it('reads columns in template order when there is no header row', () => {
    const result = parseCourseRows([[MATH_2025, 'MA101', 'Algebra', '1', '', 'Yes']]);
    expect(result.headerDetected).toBe(false);
    expect(result.rows[0]).toMatchObject({ sourceRow: 1, code: 'MA101', isLaboratory: true });
  });

  it('refuses a header row missing a required column', () => {
    const result = parseCourseRows([['Batch', 'Course code', 'Title'], [MATH_2025, 'MA101', 'Algebra']]);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toMatch(/“Semester”/);
  });

  it('skips blank rows without reporting them', () => {
    const result = parse(['', '', '', '', '', ''], [MATH_2025, 'MA101', 'Algebra', '1', '', '']);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.sourceRow)).toEqual([3]);
  });

  it('reports every problem on a row at once', () => {
    // One stray value, since an all-empty row is skipped as blank.
    const stray = only('', '', '', '', '', 'Maybe');
    expect(stray.errors[0]!.message).toBe(
      'The batch is missing; the course code is missing; the title is missing; the semester is missing; Laboratory must be Yes or No (got “Maybe”).',
    );
  });
});

describe('semester', () => {
  it('accepts 1 and 12, the boundaries', () => {
    expect(only(MATH_2025, 'A', 'T', '1').errors).toEqual([]);
    expect(only(MATH_2025, 'A', 'T', '12').errors).toEqual([]);
  });

  it('refuses 0, 13, a fraction and text', () => {
    for (const value of ['0', '13', '1.5', 'one']) {
      expect(only(MATH_2025, 'A', 'T', value).errors[0]?.message, value).toMatch(/whole number from 1 to 12/);
    }
  });
});

describe('credits', () => {
  it('is optional', () => {
    expect(only(MATH_2025, 'A', 'T', '1', '').rows[0]!.credits).toBeNull();
  });

  it('accepts whole numbers, one decimal place, and zero', () => {
    for (const value of ['0', '4', '4.5', '0.3', '999.9']) {
      expect(only(MATH_2025, 'A', 'T', '1', value).errors, value).toEqual([]);
    }
  });

  it('keeps the value exactly as a decimal string', () => {
    expect(only(MATH_2025, 'A', 'T', '1', '0.3').rows[0]!.credits).toBe('0.3');
  });

  it('refuses negatives, two decimal places, too large, and text', () => {
    for (const value of ['-1', '4.25', '1000', 'four']) {
      expect(only(MATH_2025, 'A', 'T', '1', value).errors[0]?.message, value).toMatch(/^Credits must be/);
    }
  });
});

describe('laboratory', () => {
  it('defaults to No when empty', () => {
    expect(only(MATH_2025, 'A', 'T', '1', '', '').rows[0]!.isLaboratory).toBe(false);
  });

  it('accepts Yes/No in any case, and Y/N', () => {
    for (const [value, expected] of [['Yes', true], ['yes', true], ['Y', true], ['No', false], ['n', false]] as const) {
      expect(only(MATH_2025, 'A', 'T', '1', '', value).rows[0]!.isLaboratory, value).toBe(expected);
    }
  });
});

describe('planning against what exists', () => {
  const rows = (...codes: [string, string][]) =>
    parse(...codes.map(([label, code]) => [label, code, 'Title', '1', '', ''])).rows;

  it('creates a new course in the named batch', () => {
    const plan = planCourseImport(rows([MATH_2025, 'MA101']), BATCHES, []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0]).toMatchObject({ batchId: 'b-math-2025', departmentId: 'd-math', code: 'MA101' });
    expect(plan.errors).toEqual([]);
  });

  it('skips a code the batch already has — never an update', () => {
    const plan = planCourseImport(rows([MATH_2025, 'MA101']), BATCHES, [{ batchId: 'b-math-2025', code: 'MA101' }]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.alreadyExists.map((c) => c.code)).toEqual(['MA101']);
  });

  it('the same code in a DIFFERENT batch is a new course', () => {
    const plan = planCourseImport(rows([PHYS_2025, 'MA101']), BATCHES, [{ batchId: 'b-math-2025', code: 'MA101' }]);
    expect(plan.toCreate.map((c) => c.batchId)).toEqual(['b-phys-2025']);
  });

  it('refuses an unknown batch, saying how to fix it', () => {
    const plan = planCourseImport(rows(['Mathematics · B.Sc. Mathematics · 2031–2034', 'MA101']), BATCHES, []);
    expect(plan.errors[0]!.message).toMatch(/No batch .* download a fresh template/);
  });

  it('refuses the same code twice for the same batch, naming the first row', () => {
    const plan = planCourseImport(rows([MATH_2025, 'MA101'], [MATH_2025, 'MA101']), BATCHES, []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.errors).toEqual([{ row: 3, message: 'MA101 is already on row 2 for the same batch.' }]);
  });

  it('refuses a label that matches two batches rather than guessing', () => {
    const twins: KnownBatch[] = [...BATCHES, { id: 'b-twin', label: MATH_2025.toUpperCase(), departmentId: 'd-math' }];
    expect(planCourseImport(rows([MATH_2025, 'MA101']), twins, []).errors[0]!.message).toMatch(/more than one batch/);
  });
});

describe('when confirm is offered', () => {
  const plan = (errors = 0, toCreate = 1) => ({
    toCreate: Array.from({ length: toCreate }, () => ({}) as never),
    alreadyExists: [],
    errors: Array.from({ length: errors }, (_, i) => ({ row: i, message: 'x' })),
  });

  it('only for a clean file that creates something', () => {
    expect(canCommit([], plan())).toBe(true);
    expect(canCommit([{ row: 2, message: 'x' }], plan())).toBe(false);
    expect(canCommit([], plan(1))).toBe(false);
    expect(canCommit([], plan(0, 0))).toBe(false);
  });
});

describe('the Excel template', () => {
  const load = async (buffer: ArrayBuffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  };

  it('puts the course sheet first — the importer reads the first sheet', async () => {
    const workbook = await load(await buildCourseImportTemplateBuffer([MATH_2025]));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Courses', 'Batches', 'Instructions']);
    expect(workbook.worksheets[0]!.getRow(1).values).toEqual([undefined, ...COURSE_IMPORT_HEADERS]);
  });

  it('lists every batch on the Batches sheet and points the dropdown at it', async () => {
    const workbook = await load(await buildCourseImportTemplateBuffer([MATH_2025, PHYS_2025]));
    const lists = workbook.getWorksheet('Batches')!;
    expect([lists.getCell('A2').value, lists.getCell('A3').value]).toEqual([MATH_2025, PHYS_2025]);
    const courses = workbook.getWorksheet('Courses')!;
    expect(courses.getCell('A2').dataValidation).toMatchObject({ type: 'list', formulae: ['Batches!$A$2:$A$3'] });
  });

  it('checks semester, credits and laboratory on every data row, the last one included', async () => {
    const courses = (await load(await buildCourseImportTemplateBuffer([MATH_2025]))).getWorksheet('Courses')!;
    const last = MAX_COURSE_IMPORT_ROWS + 1;
    for (const row of [2, last]) {
      expect(courses.getCell(row, 4).dataValidation).toMatchObject({ type: 'whole', formulae: [1, 12] });
      expect(courses.getCell(row, 5).dataValidation).toMatchObject({ type: 'decimal' });
      expect(courses.getCell(row, 6).dataValidation).toMatchObject({ type: 'list', formulae: ['"Yes,No"'] });
    }
  });

  it('round-trips: a filled-in template imports as the rows typed into it', async () => {
    const workbook = await load(await buildCourseImportTemplateBuffer([MATH_2025, PHYS_2025]));
    const courses = workbook.getWorksheet('Courses')!;
    courses.getRow(2).values = [MATH_2025, 'MA101', 'Algebra', 1, 4.5, 'No'];
    courses.getRow(3).values = [PHYS_2025, 'PH101L', 'Physics Lab I', 1, 2, 'Yes'];
    const filled = await workbook.xlsx.writeBuffer();

    const grid = await decodeSpreadsheet(new File([filled], 'courses.xlsx'));
    const parsed = parseCourseRows(grid);
    expect(parsed.errors).toEqual([]);
    const plan = planCourseImport(parsed.rows, BATCHES, []);
    expect(plan.errors).toEqual([]);
    expect(plan.toCreate.map((c) => [c.batchId, c.code, c.semester, c.credits, c.isLaboratory])).toEqual([
      ['b-math-2025', 'MA101', 1, '4.5', false],
      ['b-phys-2025', 'PH101L', 1, '2', true],
    ]);
  });
});
