import { describe, expect, it } from 'vitest';
import {
  buildMarkTemplate,
  instructionLines,
  markKey,
  templateAsRows,
  templateFileName,
  type TemplateItem,
  type TemplateStudent,
} from '../lib/markTemplate';
import { planMarkImport } from '../lib/marks';

/**
 * The downloadable mark template (FR-12). Pure — no database.
 *
 * The test that matters is the round trip: whatever this produces must
 * come back through planMarkImport with no unknown columns, no missing
 * columns and no invalid cells. A template the app's own importer
 * complains about would be worse than none.
 */

const items: TemplateItem[] = [
  { id: 'i1', label: 'Q1', maxMark: 2, sectionName: 'Section A' },
  { id: 'i2', label: 'Q2', maxMark: 2, sectionName: 'Section A' },
  { id: 'i3', label: 'Q3(a)', maxMark: 5, sectionName: 'Section B' },
];
const students: TemplateStudent[] = [
  { registerNumber: '24MAT001', studentName: 'Anitha R' },
  { registerNumber: '24MAT002', studentName: 'Bala K' },
];
const enrolments = students.map((s, i) => ({ enrolmentId: `e${i + 1}`, ...s }));

describe('the grid', () => {
  it('heads the mark columns with the item labels EXACTLY', () => {
    // The importer matches on these strings; decoration here breaks it.
    const { headers } = buildMarkTemplate(items, students);
    expect(headers).toEqual(['Register No', 'Name', 'Q1', 'Q2', 'Q3(a)']);
  });

  it('writes one row per student, carrying the register number and name', () => {
    const { rows } = buildMarkTemplate(items, students);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.slice(0, 2)).toEqual(['24MAT001', 'Anitha R']);
  });

  it('leaves an unmarked assessment EMPTY rather than zero', () => {
    // Pre-filled zeros would turn every unattempted question into an
    // attempt scoring nothing — the blank ≠ zero rule, at the source.
    const { rows } = buildMarkTemplate(items, students);
    for (const row of rows) expect(row.slice(2)).toEqual(['', '', '']);
  });

  it('copes with an assessment of one item (a single score)', () => {
    const single: TemplateItem[] = [{ id: 'i1', label: 'Total', maxMark: 75, sectionName: null }];
    expect(buildMarkTemplate(single, students).headers).toEqual(['Register No', 'Name', 'Total']);
  });

  it('produces a header-only grid when nobody is enrolled', () => {
    const grid = buildMarkTemplate(items, []);
    expect(grid.rows).toEqual([]);
    expect(templateAsRows(grid)).toHaveLength(1);
  });
});

describe('marks already recorded', () => {
  const existing = new Map<string, number | null>([
    [markKey('24MAT001', 'i1'), 2],
    [markKey('24MAT001', 'i2'), 0], // attempted, scored nothing
    [markKey('24MAT001', 'i3'), null], // did not attempt
    [markKey('24MAT002', 'i1'), 1.5],
  ]);

  it('carries existing marks into the sheet', () => {
    const { rows } = buildMarkTemplate(items, students, existing);
    expect(rows[0]!.slice(2)).toEqual(['2', '0', '']);
    expect(rows[1]!.slice(2)).toEqual(['1.5', '', '']);
  });

  it('writes a recorded 0 as 0 and a recorded blank as empty', () => {
    const { rows } = buildMarkTemplate(items, students, existing);
    expect(rows[0]![3]).toBe('0'); // a real zero survives
    expect(rows[0]![4]).toBe(''); // a blank stays blank
  });

  it('DOES NOT propose to blank existing marks when downloaded and re-uploaded untouched', () => {
    // The trap this exists to prevent: an empty template uploaded over a
    // part-marked assessment reads as "nobody attempted anything" and
    // wipes every stored mark.
    const storedByEnrolment = new Map<string, number | null>([
      ['e1:i1', 2],
      ['e1:i2', 0],
      ['e1:i3', null],
      ['e2:i1', 1.5],
    ]);
    const plan = planMarkImport({
      rows: templateAsRows(buildMarkTemplate(items, students, existing)),
      items: items.map((i) => ({ id: i.id, label: i.label, maxMark: i.maxMark })),
      enrolments,
      existing: storedByEnrolment,
    });
    expect(plan.changes).toEqual([]);
    expect(plan.invalid).toEqual([]);
  });

  it('and an EMPTY template over the same marks would have blanked them', () => {
    // Pins why the pre-fill is necessary, not merely convenient.
    const storedByEnrolment = new Map<string, number | null>([['e1:i1', 2], ['e1:i2', 0], ['e2:i1', 1.5]]);
    const plan = planMarkImport({
      rows: templateAsRows(buildMarkTemplate(items, students)), // no existing marks
      items: items.map((i) => ({ id: i.id, label: i.label, maxMark: i.maxMark })),
      enrolments,
      existing: storedByEnrolment,
    });
    expect(plan.changes).toHaveLength(3);
    expect(plan.changes.every((c) => c.newValue === null)).toBe(true);
  });

  it('changes only the cell that was edited', () => {
    const rows = templateAsRows(buildMarkTemplate(items, students, existing));
    rows[1]![4] = '5'; // Anitha's Q3(a), previously not attempted
    const plan = planMarkImport({
      rows,
      items: items.map((i) => ({ id: i.id, label: i.label, maxMark: i.maxMark })),
      enrolments,
      existing: new Map([['e1:i1', 2], ['e1:i2', 0], ['e1:i3', null], ['e2:i1', 1.5]]),
    });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ registerNumber: '24MAT001', itemLabel: 'Q3(a)', oldValue: null, newValue: 5 });
  });
});

describe('round trip through the real importer', () => {
  const plan = () =>
    planMarkImport({
      rows: templateAsRows(buildMarkTemplate(items, students)),
      items: items.map((i) => ({ id: i.id, label: i.label, maxMark: i.maxMark })),
      enrolments,
      existing: new Map(),
    });

  it('reports no unknown columns — the Name column is understood, not flagged', () => {
    expect(plan().unknownColumns).toEqual([]);
  });

  it('reports no missing columns — every item has a column', () => {
    expect(plan().missingColumns).toEqual([]);
  });

  it('matches every student', () => {
    expect(plan().unmatchedRegisterNumbers).toEqual([]);
  });

  it('produces no invalid cells and no changes from an untouched template', () => {
    const result = plan();
    expect(result.invalid).toEqual([]);
    // Empty cells against no stored marks: blank → blank, nothing to do.
    expect(result.changes).toEqual([]);
    expect(result.unchanged).toBe(items.length * students.length);
  });

  it('carries typed marks through, including a real zero', () => {
    const rows = templateAsRows(buildMarkTemplate(items, students));
    rows[1]![2] = '2'; // Anitha, Q1
    rows[1]![3] = '0'; // Anitha, Q2 — attempted, scored nothing
    rows[2]![4] = '4.5'; // Bala, Q3(a)
    const result = planMarkImport({
      rows,
      items: items.map((i) => ({ id: i.id, label: i.label, maxMark: i.maxMark })),
      enrolments,
      existing: new Map(),
    });
    expect(result.invalid).toEqual([]);
    expect(result.changes.map((c) => [c.registerNumber, c.itemLabel, c.newValue])).toEqual([
      ['24MAT001', 'Q1', 2],
      ['24MAT001', 'Q2', 0],
      ['24MAT002', 'Q3(a)', 4.5],
    ]);
  });

  it('still rejects a mark above the item maximum', () => {
    const rows = templateAsRows(buildMarkTemplate(items, students));
    rows[1]![2] = '9'; // Q1 is out of 2
    const result = planMarkImport({
      rows,
      items: items.map((i) => ({ id: i.id, label: i.label, maxMark: i.maxMark })),
      enrolments,
      existing: new Map(),
    });
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]!.reason).toMatch(/over the maximum/);
  });
});

describe('filename', () => {
  it('is recognisable and safe for a filesystem', () => {
    expect(templateFileName('MAT301', 'Internal Test I')).toBe('MAT301-Internal-Test-I-marks-template.xlsx');
  });

  it('strips punctuation that would break a download', () => {
    expect(templateFileName('MAT/301', 'Quiz #1 (Unit 2)')).toBe('MAT-301-Quiz-1-Unit-2-marks-template.xlsx');
  });
});

describe('instructions', () => {
  const lines = instructionLines({
    courseCode: 'MAT301',
    courseTitle: 'Real Analysis',
    assessmentName: 'Internal Test I',
    items,
    studentCount: 2,
  });

  it('states the blank ≠ zero rule in plain words', () => {
    const text = lines.join('\n');
    expect(text).toMatch(/LEAVE A CELL EMPTY/);
    expect(text).toMatch(/An empty cell and a 0 are NOT the same thing/);
  });

  it('lists every question with its maximum and section', () => {
    const text = lines.join('\n');
    for (const item of items) expect(text).toContain(`${item.label} — maximum ${item.maxMark}`);
    expect(text).toContain('Section A · Q1');
  });

  it('warns against renaming headings or altering register numbers', () => {
    const text = lines.join('\n');
    expect(text).toMatch(/do not rename the column headings/i);
    expect(text).toMatch(/do not change the register/i);
  });
});
