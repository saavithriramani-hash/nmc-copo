import { planMarkImport, type ImportEnrolment, type ImportItem, type MarkImportPlan } from './marks';

/**
 * The course-wide mark workbook (FR-12): one downloadable file per
 * course, one sheet per assessment, filled in and uploaded once.
 *
 * Pure. `courseWorkbookFile.ts` turns this into a workbook and the
 * actions do the database work; everything decided here can be tested
 * without either. The single-assessment logic is reused unchanged —
 * `buildMarkTemplate` per sheet on the way out, `planMarkImport` per
 * sheet on the way back — so the two paths cannot disagree about what a
 * mark file means.
 *
 * The rule that governs the whole feature: **every sheet ships carrying
 * the marks already recorded**. An empty cell means "did not attempt",
 * so a blank workbook uploaded would blank the entire course at once —
 * the single-assessment template's hazard multiplied by the number of
 * assessments. An untouched download must therefore propose exactly zero
 * changes, which is the first thing the tests assert.
 */

/** Guidance sheet. Never an assessment, never read by the importer. */
export const INSTRUCTIONS_SHEET = 'Instructions';

/**
 * Names Excel will not accept for a worksheet, plus our own.
 * "History" is reserved by Excel itself.
 */
const RESERVED_SHEET_NAMES = [INSTRUCTIONS_SHEET, 'History'];

/** Excel forbids these characters in a worksheet name. */
const ILLEGAL_SHEET_CHARS = /[:\\/?*[\]]/g;

export const SHEET_NAME_LIMIT = 31;

/**
 * One assessment name as a worksheet name — lossy, and unavoidably so:
 * Excel caps a name at 31 characters and forbids `: \ / ? * [ ]`, while
 * an assessment name is free text.
 */
export function sanitiseSheetName(name: string): string {
  const cleaned = name
    .replace(ILLEGAL_SHEET_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '') // Excel rejects a leading or trailing apostrophe
    .trim();
  const clipped = cleaned.slice(0, SHEET_NAME_LIMIT).trim();
  return clipped === '' ? 'Assessment' : clipped;
}

/** Excel treats sheet names case-insensitively when checking uniqueness. */
const fold = (name: string): string => name.trim().toLowerCase();

/**
 * A worksheet name for every assessment, unique and stable.
 *
 * Truncation collides in exactly the case a college hits: "Continuous
 * Internal Assessment I" and "Continuous Internal Assessment II" are 31
 * and 32 characters, so both clip to the same string. The loser gets a
 * " (2)" suffix, with the base shortened to make room.
 *
 * Determinism is the contract. The same assessments in the same order
 * must yield the same names every time, because upload matching re-runs
 * this against the CURRENT assessments and looks the sheet up by name.
 * Callers must pass assessments in a stable order (displayOrder).
 */
export function assignSheetNames(assessments: readonly { id: string; name: string }[]): Map<string, string> {
  const used = new Set(RESERVED_SHEET_NAMES.map(fold));
  const assigned = new Map<string, string>();

  for (const assessment of assessments) {
    const base = sanitiseSheetName(assessment.name);
    let candidate = base;
    for (let n = 2; used.has(fold(candidate)); n += 1) {
      const suffix = ` (${n})`;
      candidate = `${base.slice(0, SHEET_NAME_LIMIT - suffix.length).trim()}${suffix}`;
    }
    used.add(fold(candidate));
    assigned.set(assessment.id, candidate);
  }
  return assigned;
}

// ── upload ───────────────────────────────────────────────────────────────

export interface CourseImportAssessment {
  id: string;
  name: string;
  items: ImportItem[];
}

export interface CourseSheetResult {
  assessmentId: string;
  assessmentName: string;
  sheetName: string;
  plan: MarkImportPlan;
}

export interface CourseImportPlan {
  /** One entry per assessment whose sheet was found, in course order. */
  sheets: CourseSheetResult[];
  /** Sheets in the file that match no assessment. Reported, never guessed. */
  unmatchedSheets: string[];
  /** Assessments with no sheet in the file — normal when trimming a workbook. */
  assessmentsWithoutSheet: string[];
  /**
   * CR-3: assessments this person may not enter — the end-semester paper
   * of a theory course for the department, or anything else for the
   * Controller of Examinations. Named rather than silently dropped, so
   * the preview does not look like the workbook was misread.
   */
  notPermitted?: string[];
  totals: {
    changes: number;
    unchanged: number;
    invalid: number;
    /** Register numbers unknown to the course, deduplicated across sheets. */
    unmatchedRegisterNumbers: string[];
    unknownColumns: number;
    missingColumns: number;
  };
}

/**
 * Diffs a whole uploaded workbook against the marks on record.
 *
 * Matching is by worksheet name, re-derived from the current assessments
 * — never guessed. An assessment renamed between download and upload
 * therefore stops matching and appears under `unmatchedSheets`, which is
 * the honest outcome: the alternative is writing one assessment's marks
 * onto another.
 *
 * `existing` is course-wide, keyed `${enrolmentId}:${itemId}`. Item ids
 * are unique across the course, so one map serves every sheet.
 */
export function planCourseImport(args: {
  sheets: ReadonlyMap<string, string[][]>;
  assessments: readonly CourseImportAssessment[];
  enrolments: ImportEnrolment[];
  existing: Map<string, number | null>;
}): CourseImportPlan {
  const names = assignSheetNames(args.assessments);
  const sheetsByFoldedName = new Map<string, { name: string; rows: string[][] }>();
  for (const [name, rows] of args.sheets) sheetsByFoldedName.set(fold(name), { name, rows });

  const sheets: CourseSheetResult[] = [];
  const claimed = new Set<string>();
  const assessmentsWithoutSheet: string[] = [];

  for (const assessment of args.assessments) {
    const sheetName = names.get(assessment.id)!;
    const found = sheetsByFoldedName.get(fold(sheetName));
    if (!found) {
      assessmentsWithoutSheet.push(assessment.name);
      continue;
    }
    claimed.add(fold(sheetName));
    sheets.push({
      assessmentId: assessment.id,
      assessmentName: assessment.name,
      sheetName,
      plan: planMarkImport({
        rows: found.rows,
        items: assessment.items,
        enrolments: args.enrolments,
        existing: args.existing,
      }),
    });
  }

  const unmatchedSheets: string[] = [];
  for (const [folded, sheet] of sheetsByFoldedName) {
    if (claimed.has(folded)) continue;
    // The guidance sheet is ours and is not meant to match anything.
    if (RESERVED_SHEET_NAMES.some((reserved) => fold(reserved) === folded)) continue;
    unmatchedSheets.push(sheet.name);
  }

  const unmatchedRegisterNumbers = new Set<string>();
  let changes = 0;
  let unchanged = 0;
  let invalid = 0;
  let unknownColumns = 0;
  let missingColumns = 0;
  for (const sheet of sheets) {
    changes += sheet.plan.changes.length;
    unchanged += sheet.plan.unchanged;
    invalid += sheet.plan.invalid.length;
    unknownColumns += sheet.plan.unknownColumns.length;
    missingColumns += sheet.plan.missingColumns.length;
    for (const reg of sheet.plan.unmatchedRegisterNumbers) unmatchedRegisterNumbers.add(reg);
  }

  return {
    sheets,
    unmatchedSheets,
    assessmentsWithoutSheet,
    totals: {
      changes,
      unchanged,
      invalid,
      unmatchedRegisterNumbers: [...unmatchedRegisterNumbers],
      unknownColumns,
      missingColumns,
    },
  };
}

/** A filename staff can recognise months later, safe on every filesystem. */
export function courseWorkbookFileName(courseCode: string): string {
  const safe = courseCode
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return safe ? `${safe}-all-marks.xlsx` : 'all-marks.xlsx';
}

/** The guidance sheet's lines, in the order they are written. */
export function courseInstructionLines(args: {
  courseCode: string;
  courseTitle: string;
  studentCount: number;
  assessments: readonly { name: string; sheetName: string; items: readonly ImportItem[] }[];
}): string[] {
  const lines = [
    `${args.courseCode} — ${args.courseTitle}`,
    'Marks for every assessment in this course',
    '',
    'HOW TO USE THIS FILE',
    '',
    '1. There is one sheet per assessment. Enter marks in the question',
    '   columns only. You may fill in one sheet, several, or all of them.',
    '2. Do not rename the sheets, the column headings or the register',
    '   numbers — the marks are matched back by those.',
    '3. Save the file, then upload it on the Marks tab. Every change is',
    '   shown for checking before anything is stored, and the whole upload',
    '   is applied together or not at all.',
    '',
    'THE MARKS ALREADY RECORDED ARE FILLED IN BELOW.',
    'Leave them alone unless you mean to change them. Clearing a cell',
    'records "did not attempt" and removes that mark from the calculation.',
    '',
    'LEAVE A CELL EMPTY IF THE STUDENT DID NOT ATTEMPT THAT QUESTION.',
    'An empty cell and a 0 are NOT the same thing. An empty cell is left',
    'out of the calculation entirely; a 0 counts as an attempt that scored',
    'nothing, and lowers the attainment for that question.',
    '',
    `Students in this course: ${args.studentCount}`,
    '',
    'SHEETS IN THIS FILE',
    '',
  ];
  for (const assessment of args.assessments) {
    lines.push(`  "${assessment.sheetName}" — ${assessment.name}`);
    for (const item of assessment.items) {
      lines.push(`      ${item.label} — maximum ${item.maxMark}`);
    }
    lines.push('');
  }
  return lines;
}
