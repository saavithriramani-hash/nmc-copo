import { describe, expect, it } from 'vitest';
import {
  INSTRUCTIONS_SHEET,
  SHEET_NAME_LIMIT,
  assignSheetNames,
  courseWorkbookFileName,
  planCourseImport,
  sanitiseSheetName,
} from '../lib/courseWorkbook';
import { buildMarkTemplate, markKey, templateAsRows } from '../lib/markTemplate';
import type { ImportEnrolment, ImportItem } from '../lib/marks';

/**
 * The course-wide mark workbook (FR-12).
 *
 * The property that matters most is the round trip: a workbook that has
 * been downloaded and not edited must propose ZERO changes. An empty cell
 * imports as "did not attempt", so a workbook that failed to carry the
 * marks already recorded would blank every assessment in the course at
 * once. That is asserted first, and everything else guards a way the
 * matching could quietly go wrong.
 */

const items = (prefix: string, count: number, max = 10): ImportItem[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-i${i + 1}`, label: `Q${i + 1}`, maxMark: max }));

const enrolments: ImportEnrolment[] = [
  { enrolmentId: 'e1', registerNumber: '24MAT001', studentName: 'Anitha' },
  { enrolmentId: 'e2', registerNumber: '24MAT002', studentName: 'Bala' },
];

/** The workbook as the download builds it, sheet by sheet. */
function downloadedSheets(
  assessments: readonly { id: string; name: string; items: ImportItem[] }[],
  stored: Map<string, number | null>,
): Map<string, string[][]> {
  const names = assignSheetNames(assessments);
  const byRegister = new Map<string, number | null>();
  for (const [key, value] of stored) {
    const [enrolmentId, itemId] = key.split(':') as [string, string];
    const student = enrolments.find((e) => e.enrolmentId === enrolmentId)!;
    byRegister.set(markKey(student.registerNumber, itemId), value);
  }
  const sheets = new Map<string, string[][]>();
  for (const assessment of assessments) {
    const grid = buildMarkTemplate(
      assessment.items.map((item) => ({ ...item, sectionName: null })),
      enrolments.map((e) => ({ registerNumber: e.registerNumber, studentName: e.studentName })),
      byRegister,
    );
    sheets.set(names.get(assessment.id)!, templateAsRows(grid));
  }
  return sheets;
}

describe('sanitiseSheetName — Excel’s rules, which assessment names do not follow', () => {
  it('strips the characters Excel forbids in a sheet name', () => {
    expect(sanitiseSheetName('Test: Unit 1 / 2 [draft] *?')).toBe('Test Unit 1 2 draft');
  });

  it('clips to Excel’s 31-character limit', () => {
    const name = sanitiseSheetName('Continuous Internal Assessment Number One');
    expect(name.length).toBeLessThanOrEqual(SHEET_NAME_LIMIT);
  });

  it('never returns an empty name, whatever it is given', () => {
    expect(sanitiseSheetName('///')).toBe('Assessment');
    expect(sanitiseSheetName('   ')).toBe('Assessment');
  });

  it('drops leading and trailing apostrophes, which Excel rejects', () => {
    expect(sanitiseSheetName("'Mid-term'")).toBe('Mid-term');
  });
});

describe('assignSheetNames — uniqueness after truncation', () => {
  it('disambiguates two names that clip to the same 31 characters', () => {
    // The realistic collision: these differ only after the limit.
    const names = assignSheetNames([
      { id: 'a', name: 'Continuous Internal Assessment I' },
      { id: 'b', name: 'Continuous Internal Assessment II' },
    ]);
    const [first, second] = [names.get('a')!, names.get('b')!];
    expect(first).not.toBe(second);
    expect(second).toMatch(/\(2\)$/);
    for (const name of [first, second]) expect(name.length).toBeLessThanOrEqual(SHEET_NAME_LIMIT);
  });

  it('keeps the suffixed name within the limit by shortening the base', () => {
    const names = assignSheetNames([
      { id: 'a', name: 'A'.repeat(40) },
      { id: 'b', name: 'A'.repeat(40) },
      { id: 'c', name: 'A'.repeat(40) },
    ]);
    const all = [...names.values()];
    expect(new Set(all).size).toBe(3);
    for (const name of all) expect(name.length).toBeLessThanOrEqual(SHEET_NAME_LIMIT);
  });

  it('never collides with the Instructions sheet', () => {
    const names = assignSheetNames([{ id: 'a', name: INSTRUCTIONS_SHEET }]);
    expect(names.get('a')).not.toBe(INSTRUCTIONS_SHEET);
  });

  it('avoids "History", which Excel reserves', () => {
    expect(assignSheetNames([{ id: 'a', name: 'History' }]).get('a')).not.toBe('History');
  });

  it('is deterministic — upload re-derives these names to match sheets', () => {
    const input = [
      { id: 'a', name: 'Internal Test I' },
      { id: 'b', name: 'Internal Test II' },
    ];
    expect([...assignSheetNames(input)]).toEqual([...assignSheetNames(input)]);
  });

  it('is case-insensitive about uniqueness, as Excel is', () => {
    const names = assignSheetNames([
      { id: 'a', name: 'Quiz' },
      { id: 'b', name: 'QUIZ' },
    ]);
    expect(names.get('a')!.toLowerCase()).not.toBe(names.get('b')!.toLowerCase());
  });
});

describe('planCourseImport — the round trip', () => {
  const assessments = [
    { id: 'cia1', name: 'Internal Test I', items: items('cia1', 3) },
    { id: 'quiz', name: 'Quiz 1', items: items('quiz', 2, 5) },
  ];
  const stored = new Map<string, number | null>([
    ['e1:cia1-i1', 8],
    ['e1:cia1-i2', null], // recorded blank: did not attempt
    ['e2:cia1-i1', 0], // recorded zero: attempted, scored nothing
    ['e2:quiz-i1', 4],
  ]);

  it('an untouched download proposes NOTHING — the whole safety property', () => {
    const plan = planCourseImport({
      sheets: downloadedSheets(assessments, stored),
      assessments,
      enrolments,
      existing: stored,
    });
    expect(plan.totals.changes).toBe(0);
    expect(plan.totals.invalid).toBe(0);
    expect(plan.unmatchedSheets).toEqual([]);
    expect(plan.assessmentsWithoutSheet).toEqual([]);
    expect(plan.sheets).toHaveLength(2);
  });

  it('keeps a recorded 0 distinct from a recorded blank across the round trip', () => {
    // If the workbook wrote a stored blank as "0", or a stored 0 as empty,
    // the untouched round trip above would still report zero changes on
    // one of them. This pins the two cells individually.
    const sheets = downloadedSheets(assessments, stored);
    const cia = [...sheets.entries()].find(([name]) => name.startsWith('Internal Test I'))![1];
    const header = cia[0]!;
    const q1 = header.indexOf('Q1');
    const q2 = header.indexOf('Q2');
    const anitha = cia.find((row) => row[0] === '24MAT001')!;
    const bala = cia.find((row) => row[0] === '24MAT002')!;
    expect(anitha[q2]).toBe(''); // blank stays blank
    expect(bala[q1]).toBe('0'); // zero stays zero
  });

  it('reports only the cells actually edited', () => {
    const sheets = downloadedSheets(assessments, stored);
    const cia = sheets.get([...sheets.keys()].find((k) => k.startsWith('Internal Test I'))!)!;
    const q3 = cia[0]!.indexOf('Q3');
    cia.find((row) => row[0] === '24MAT001')![q3] = '7';

    const plan = planCourseImport({ sheets, assessments, enrolments, existing: stored });
    expect(plan.totals.changes).toBe(1);
    const change = plan.sheets.find((s) => s.assessmentId === 'cia1')!.plan.changes[0]!;
    expect(change).toMatchObject({ registerNumber: '24MAT001', itemLabel: 'Q3', oldValue: null, newValue: 7 });
  });

  it('applies changes across several sheets in one plan', () => {
    const sheets = downloadedSheets(assessments, stored);
    const cia = sheets.get([...sheets.keys()].find((k) => k.startsWith('Internal Test I'))!)!;
    const quiz = sheets.get([...sheets.keys()].find((k) => k.startsWith('Quiz 1'))!)!;
    cia.find((row) => row[0] === '24MAT002')![cia[0]!.indexOf('Q2')] = '9';
    quiz.find((row) => row[0] === '24MAT001')![quiz[0]!.indexOf('Q2')] = '3';

    const plan = planCourseImport({ sheets, assessments, enrolments, existing: stored });
    expect(plan.totals.changes).toBe(2);
    expect(plan.sheets.map((s) => s.plan.changes.length)).toEqual([1, 1]);
  });

  it('confines an invalid cell to its own sheet', () => {
    const sheets = downloadedSheets(assessments, stored);
    const quiz = sheets.get([...sheets.keys()].find((k) => k.startsWith('Quiz 1'))!)!;
    quiz.find((row) => row[0] === '24MAT001')![quiz[0]!.indexOf('Q1')] = '99'; // max is 5

    const plan = planCourseImport({ sheets, assessments, enrolments, existing: stored });
    expect(plan.totals.invalid).toBe(1);
    expect(plan.sheets.find((s) => s.assessmentId === 'cia1')!.plan.invalid).toEqual([]);
    expect(plan.sheets.find((s) => s.assessmentId === 'quiz')!.plan.invalid[0]).toMatchObject({
      registerNumber: '24MAT001',
      reason: 'over the maximum of 5',
    });
  });
});

describe('planCourseImport — matching sheets to assessments', () => {
  const assessments = [{ id: 'cia1', name: 'Internal Test I', items: items('cia1', 2) }];
  const stored = new Map<string, number | null>();

  it('reports a sheet matching no assessment rather than guessing', () => {
    // The failure to avoid is writing one assessment's marks onto another.
    const sheets = downloadedSheets(assessments, stored);
    sheets.set('Something Else', [['Register No', 'Name', 'Q1'], ['24MAT001', 'Anitha', '5']]);

    const plan = planCourseImport({ sheets, assessments, enrolments, existing: stored });
    expect(plan.unmatchedSheets).toEqual(['Something Else']);
    expect(plan.totals.changes).toBe(0);
  });

  it('treats a renamed assessment as unmatched, never as a near miss', () => {
    const sheets = downloadedSheets(assessments, stored); // sheet "Internal Test I"
    const renamed = [{ id: 'cia1', name: 'Internal Test 1 (revised)', items: items('cia1', 2) }];

    const plan = planCourseImport({ sheets, assessments: renamed, enrolments, existing: stored });
    expect(plan.unmatchedSheets).toEqual(['Internal Test I']);
    expect(plan.assessmentsWithoutSheet).toEqual(['Internal Test 1 (revised)']);
    expect(plan.totals.changes).toBe(0);
  });

  it('never reports the Instructions sheet as unmatched — it is ours', () => {
    const sheets = downloadedSheets(assessments, stored);
    sheets.set(INSTRUCTIONS_SHEET, [['CO-PO Attainment'], ['HOW TO USE THIS FILE']]);

    expect(planCourseImport({ sheets, assessments, enrolments, existing: stored }).unmatchedSheets).toEqual([]);
  });

  it('lets a workbook trimmed to one sheet import just that one', () => {
    const two = [
      { id: 'cia1', name: 'Internal Test I', items: items('cia1', 2) },
      { id: 'quiz', name: 'Quiz 1', items: items('quiz', 2) },
    ];
    const sheets = downloadedSheets(two, stored);
    sheets.delete([...sheets.keys()].find((k) => k.startsWith('Quiz 1'))!);

    const plan = planCourseImport({ sheets, assessments: two, enrolments, existing: stored });
    expect(plan.assessmentsWithoutSheet).toEqual(['Quiz 1']);
    expect(plan.unmatchedSheets).toEqual([]);
    expect(plan.sheets.map((s) => s.assessmentId)).toEqual(['cia1']);
  });

  it('matches sheet names case-insensitively, as Excel compares them', () => {
    const sheets = new Map([['internal test i', [['Register No', 'Name', 'Q1'], ['24MAT001', 'Anitha', '6']]]]);
    const plan = planCourseImport({ sheets, assessments, enrolments, existing: stored });
    expect(plan.unmatchedSheets).toEqual([]);
    expect(plan.totals.changes).toBe(1);
  });

  it('deduplicates unknown register numbers across sheets', () => {
    const two = [
      { id: 'cia1', name: 'Internal Test I', items: items('cia1', 1) },
      { id: 'quiz', name: 'Quiz 1', items: items('quiz', 1) },
    ];
    const names = assignSheetNames(two);
    const sheets = new Map([
      [names.get('cia1')!, [['Register No', 'Q1'], ['24XXX999', '5']]],
      [names.get('quiz')!, [['Register No', 'Q1'], ['24XXX999', '5']]],
    ]);
    const plan = planCourseImport({ sheets, assessments: two, enrolments, existing: stored });
    expect(plan.totals.unmatchedRegisterNumbers).toEqual(['24XXX999']);
  });
});

describe('courseWorkbookFileName', () => {
  it('is recognisable months later and safe on every filesystem', () => {
    expect(courseWorkbookFileName('MAT301')).toBe('MAT301-all-marks.xlsx');
    expect(courseWorkbookFileName('U24PHY/351')).toBe('U24PHY-351-all-marks.xlsx');
  });

  it('never returns a path, however the course was coded', () => {
    const name = courseWorkbookFileName('../../etc/passwd');
    expect(name).not.toMatch(/[/\\"']/);
    expect(name).not.toContain('..');
  });
});
