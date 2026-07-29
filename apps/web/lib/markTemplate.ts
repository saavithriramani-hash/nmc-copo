/**
 * The downloadable mark-entry template for one assessment (FR-12).
 *
 * Pure: it produces the grid, and markTemplateFile.ts turns that into a
 * workbook. Kept separate so the shape can be tested against the real
 * importer — the template is only useful if `planMarkImport` reads it
 * back with no unknown columns, no missing columns and no invalid cells.
 *
 * Column headers must be EXACTLY the item labels, because that is what
 * the importer matches on. Nothing decorative may go in the header row:
 * the maxima and the instructions live on a second sheet instead.
 */

export interface TemplateItem {
  id: string;
  label: string;
  maxMark: number;
  /** For the instructions sheet only; never part of a column header. */
  sectionName: string | null;
}
export interface TemplateStudent {
  registerNumber: string;
  studentName: string;
}

export const REGISTER_HEADER = 'Register No';
export const NAME_HEADER = 'Name';

export interface MarkTemplateGrid {
  /** Row 1, exactly as the importer expects it. */
  headers: string[];
  /** One row per student: register number, name, then empty mark cells. */
  rows: string[][];
}

/** Marks already recorded, keyed `${registerNumber}|${itemId}`. */
export type ExistingMarks = ReadonlyMap<string, number | null>;

export const markKey = (registerNumber: string, itemId: string): string => `${registerNumber}|${itemId}`;

/**
 * The template carries the marks already recorded, so it is a working
 * sheet rather than a blank one.
 *
 * This matters more than convenience. An empty cell imports as "did not
 * attempt", so a template that omitted existing marks would blank every
 * one of them the moment it was uploaded — a lecturer adding a few late
 * entries would wipe the rest of the assessment without meaning to.
 * Carrying them through means an untouched download proposes no changes
 * at all, and an edited one changes only what was edited.
 *
 * A recorded blank stays empty; a recorded 0 is written as 0, because
 * those are different facts.
 */
export function buildMarkTemplate(
  items: readonly TemplateItem[],
  students: readonly TemplateStudent[],
  existing: ExistingMarks = new Map(),
): MarkTemplateGrid {
  const headers = [REGISTER_HEADER, NAME_HEADER, ...items.map((item) => item.label)];
  const rows = students.map((student) => [
    student.registerNumber,
    student.studentName,
    ...items.map((item) => {
      const value = existing.get(markKey(student.registerNumber, item.id));
      // Absent or null = not attempted = an empty cell, never a zero.
      return value === undefined || value === null ? '' : String(value);
    }),
  ]);
  return { headers, rows };
}

/** The whole grid, header included — what the importer would receive. */
export function templateAsRows(grid: MarkTemplateGrid): string[][] {
  return [grid.headers, ...grid.rows];
}

/** A filename a member of staff can recognise months later. */
export function templateFileName(courseCode: string, assessmentName: string): string {
  const safe = (value: string) =>
    value
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  return `${safe(courseCode)}-${safe(assessmentName)}-marks-template.xlsx`;
}

/** The guidance placed on the second sheet, in the order it is written. */
export function instructionLines(args: {
  courseCode: string;
  courseTitle: string;
  assessmentName: string;
  items: readonly TemplateItem[];
  studentCount: number;
}): string[] {
  const lines = [
    `${args.courseCode} — ${args.courseTitle}`,
    args.assessmentName,
    '',
    'HOW TO USE THIS FILE',
    '',
    '1. Enter marks on the "Marks" sheet, in the question columns only.',
    '2. Do not rename the column headings, and do not change the register',
    '   numbers — the marks are matched back by those.',
    '3. Save the file, then upload it on the same Marks page. Every change',
    '   is shown for checking before anything is stored.',
    '',
    'LEAVE A CELL EMPTY IF THE STUDENT DID NOT ATTEMPT THAT QUESTION.',
    'An empty cell and a 0 are NOT the same thing. An empty cell is left',
    'out of the calculation entirely; a 0 counts as an attempt that scored',
    'nothing, and lowers the attainment for that question.',
    '',
    `Students on this sheet: ${args.studentCount}`,
    '',
    'QUESTIONS AND THEIR MAXIMUM MARKS',
    '',
  ];
  for (const item of args.items) {
    const where = item.sectionName === null ? '' : `${item.sectionName} · `;
    lines.push(`  ${where}${item.label} — maximum ${item.maxMark}`);
  }
  return lines;
}
