/**
 * CR-11: bulk course import, pure and testable. Turns decoded spreadsheet
 * rows into course rows and plans them against the batches and courses
 * that exist, so the preview shows exactly what will be created before
 * anything is written — the same two-step shape as the roster and account
 * imports.
 *
 * Rules enforced here rather than left to the caller:
 *
 * - **The batch is named by one label**, "Department · Programme · Batch",
 *   which the template offers as a dropdown. Names are unique at each
 *   level (department per institution, programme per department, batch
 *   per programme), so the label names exactly one batch.
 *
 * - **An existing code in the same batch is a skip, never an update.**
 *   Re-running a corrected file is the normal way an import is used, so
 *   a second run must be safe; changing a catalogue entry is a deliberate
 *   edit on the course's own page, where the prior value is audited.
 *
 * - **Any row error blocks the whole import.** The catalogue is never
 *   half-imported: fix the file and upload it again.
 *
 * What an imported course gets is exactly what "New course" gives it:
 * DRAFT, no COs, no assessments, no faculty (the HoD staffs it, FR-4).
 */

export const MAX_COURSE_IMPORT_ROWS = 1000;

export const COURSE_IMPORT_HEADERS = ['Batch', 'Course code', 'Title', 'Semester', 'Credits', 'Laboratory'] as const;

/** The highest semester the New course form accepts. */
export const MAX_SEMESTER = 12;
/** Course.credits is Decimal(4,1). */
export const MAX_CREDITS = 999.9;
export const MAX_TEXT_LENGTH = 200;

/** "Mathematics · B.Sc. Mathematics · 2025–2028" — the one way a batch is named in a file. */
export function batchLabel(batch: { departmentName: string; programmeName: string; batchName: string }): string {
  return `${batch.departmentName} · ${batch.programmeName} · ${batch.batchName}`;
}

/**
 * Lenient matching for a label typed or pasted by hand: case, runs of
 * spaces and the separator's spacing are not what anyone means to vary.
 */
export function normaliseLabel(label: string): string {
  return label
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface CourseImportRow {
  /** 1-based row in the source file, so the preview can point at it. */
  sourceRow: number;
  batchLabel: string;
  code: string;
  title: string;
  semester: number;
  /** One decimal place at most, as text, so nothing is lost to floating point. */
  credits: string | null;
  isLaboratory: boolean;
}

export interface CourseImportError {
  row: number;
  message: string;
}

export interface CourseParseResult {
  rows: CourseImportRow[];
  errors: CourseImportError[];
  headerDetected: boolean;
}

const LAB_YES = new Set(['yes', 'y', 'true', '1']);
const LAB_NO = new Set(['no', 'n', 'false', '0', '']);

const headerKey = (cell: string): string => cell.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Reads the grid. A first row naming "Course code" is a header, and its
 * columns are found by name, so they may be in any order; without one the
 * columns are positional, in template order.
 */
export function parseCourseRows(grid: string[][]): CourseParseResult {
  const errors: CourseImportError[] = [];
  const rows: CourseImportRow[] = [];
  if (grid.length === 0) return { rows, errors, headerDetected: false };

  const first = (grid[0] ?? []).map(headerKey);
  const headerDetected = first.includes('course code');
  const columns = new Map<string, number>();
  COURSE_IMPORT_HEADERS.forEach((name, position) => {
    columns.set(name, headerDetected ? first.indexOf(headerKey(name)) : position);
  });
  if (headerDetected) {
    const missing = COURSE_IMPORT_HEADERS.slice(0, 4).filter((name) => columns.get(name) === -1);
    if (missing.length > 0) {
      errors.push({ row: 1, message: `The header row has no ${missing.map((m) => `“${m}”`).join(', ')} column.` });
      return { rows, errors, headerDetected };
    }
  }

  const start = headerDetected ? 1 : 0;
  for (let index = start; index < grid.length; index += 1) {
    const cells = grid[index] ?? [];
    const sourceRow = index + 1;
    const cell = (name: (typeof COURSE_IMPORT_HEADERS)[number]): string => {
      const column = columns.get(name) ?? -1;
      return column < 0 ? '' : (cells[column] ?? '').trim();
    };
    if (cells.every((value) => value.trim() === '')) continue;

    const problems: string[] = [];
    const label = cell('Batch');
    const code = cell('Course code');
    const title = cell('Title');
    const semesterText = cell('Semester');
    const creditsText = cell('Credits');
    const labText = cell('Laboratory').toLowerCase();

    if (!label) problems.push('the batch is missing');
    if (!code) problems.push('the course code is missing');
    else if (code.length > MAX_TEXT_LENGTH) problems.push(`the course code is longer than ${MAX_TEXT_LENGTH} characters`);
    if (!title) problems.push('the title is missing');
    else if (title.length > MAX_TEXT_LENGTH) problems.push(`the title is longer than ${MAX_TEXT_LENGTH} characters`);

    const semester = Number(semesterText);
    if (!semesterText) problems.push('the semester is missing');
    else if (!Number.isInteger(semester) || semester < 1 || semester > MAX_SEMESTER) {
      problems.push(`the semester must be a whole number from 1 to ${MAX_SEMESTER} (got “${semesterText}”)`);
    }

    let credits: string | null = null;
    if (creditsText !== '') {
      // Checked as text: multiplying by ten to count decimals misjudges
      // values like 0.3, which floating point cannot hold exactly.
      const value = Number(creditsText);
      if (!/^\d+(\.\d)?$/.test(creditsText) || value > MAX_CREDITS) {
        problems.push(`credits must be a number from 0 to ${MAX_CREDITS} with at most one decimal place (got “${creditsText}”)`);
      } else {
        credits = String(value);
      }
    }

    let isLaboratory = false;
    if (LAB_YES.has(labText)) isLaboratory = true;
    else if (!LAB_NO.has(labText)) problems.push(`Laboratory must be Yes or No (got “${cell('Laboratory')}”)`);

    if (problems.length > 0) {
      errors.push({ row: sourceRow, message: capitalise(problems.join('; ')) + '.' });
      continue;
    }
    rows.push({ sourceRow, batchLabel: label, code, title, semester, credits, isLaboratory });
  }

  return { rows, errors, headerDetected };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── planning against the database ────────────────────────────────────────

export interface KnownBatch {
  id: string;
  label: string;
  departmentId: string;
}

export interface PlannedCourse extends CourseImportRow {
  batchId: string;
  departmentId: string;
}

export interface CourseImportPlan {
  toCreate: PlannedCourse[];
  /** A course with this code already exists in that batch: skipped, never updated. */
  alreadyExists: PlannedCourse[];
  errors: CourseImportError[];
}

export function planCourseImport(
  rows: readonly CourseImportRow[],
  batches: readonly KnownBatch[],
  /** Every existing (batch, code) pair among the batches the file names. */
  existing: readonly { batchId: string; code: string }[],
): CourseImportPlan {
  const byLabel = new Map<string, KnownBatch[]>();
  for (const batch of batches) {
    const key = normaliseLabel(batch.label);
    byLabel.set(key, [...(byLabel.get(key) ?? []), batch]);
  }
  const taken = new Set(existing.map((e) => `${e.batchId}\u0000${e.code}`));
  const firstRowFor = new Map<string, number>();

  const plan: CourseImportPlan = { toCreate: [], alreadyExists: [], errors: [] };
  for (const row of rows) {
    const matches = byLabel.get(normaliseLabel(row.batchLabel)) ?? [];
    if (matches.length === 0) {
      plan.errors.push({
        row: row.sourceRow,
        message: `No batch “${row.batchLabel}”. Pick it from the template’s dropdown, or download a fresh template if the batch is new.`,
      });
      continue;
    }
    if (matches.length > 1) {
      // Unreachable while names are unique at each level; refused rather
      // than guessed if a name ever contains the separator itself.
      plan.errors.push({ row: row.sourceRow, message: `“${row.batchLabel}” matches more than one batch.` });
      continue;
    }
    const batch = matches[0]!;
    const key = `${batch.id}\u0000${row.code}`;
    const earlier = firstRowFor.get(key);
    if (earlier !== undefined) {
      plan.errors.push({ row: row.sourceRow, message: `${row.code} is already on row ${earlier} for the same batch.` });
      continue;
    }
    firstRowFor.set(key, row.sourceRow);

    const planned: PlannedCourse = { ...row, batchId: batch.id, departmentId: batch.departmentId };
    if (taken.has(key)) plan.alreadyExists.push(planned);
    else plan.toCreate.push(planned);
  }
  return plan;
}

/** Confirm is offered only for a clean file that would create something. */
export function canCommit(parseErrors: readonly CourseImportError[], plan: CourseImportPlan): boolean {
  return parseErrors.length === 0 && plan.errors.length === 0 && plan.toCreate.length > 0;
}

/** The guidance sheet of the template, one line per row. */
export function templateInstructions(batchCount: number): string[] {
  return [
    'COURSE IMPORT',
    '',
    'Fill in one row per course on the “Courses” sheet, then upload the file on the Courses page (Import courses).',
    '',
    `Batch — pick from the dropdown. It lists all ${batchCount} batch${batchCount === 1 ? '' : 'es'} as “Department · Programme · Batch”, as they were when this file was downloaded. For a batch created since, download a fresh template.`,
    'Course code and Title — required.',
    `Semester — a whole number from 1 to ${MAX_SEMESTER}.`,
    'Credits — optional; a number with at most one decimal place.',
    'Laboratory — Yes for a practical paper, whose end-semester examination the department conducts; otherwise No (the default).',
    '',
    'A course whose code already exists in the same batch is skipped and left unchanged, so uploading a corrected file again is safe.',
    'If any row has a problem, nothing is created: the preview lists every problem by row number.',
    'Imported courses start as drafts with no outcomes, assessments or faculty. The Head of Department assigns who teaches each.',
    `At most ${MAX_COURSE_IMPORT_ROWS} courses per file.`,
  ];
}
