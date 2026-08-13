import { describe, expect, it } from 'vitest';
import { computeKnowledgeLevels, DEFAULT_PARAMETERS, EngineAssertionError } from '../src/index';
import type { KnowledgeItem, KnowledgeLevelInput } from '../src/index';

/**
 * Learning outcome by knowledge level.
 *
 * Every expected value below is worked out by hand in the comment beside
 * it (NFR-7). The college's own workbook is used as a statement of the
 * METHOD — the arithmetic it describes — and never as an oracle for a
 * number: the figures in the shipped sheet are re-derived here from
 * first principles, and one of the tests exists precisely because the
 * sheet gets a boundary wrong.
 */

const BANDS = DEFAULT_PARAMETERS.bands; // ≥80 → 3, ≥60 → 2, ≥40 → 1, else 0
const LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate'];

const item = (id: string, maxMark: number, level: string): KnowledgeItem => ({ id, maxMark, level });

const run = (over: Partial<KnowledgeLevelInput> = {}) =>
  computeKnowledgeLevels({
    levels: LEVELS,
    items: [],
    marks: {},
    studentIds: [],
    bands: BANDS,
    ...over,
  });

describe('the blueprint — what the paper set out to examine', () => {
  /**
   * The shape of the college's own paper, re-derived: 23 questions in
   * four sections, 10×1 + 5×2 + 5×5 + 3×10 = 75 marks, allotted
   * 6/9/9/21/30 across the five levels.
   */
  const collegePaper: KnowledgeItem[] = [
    // Section A, 1 mark each
    item('a1', 1, 'Remember'), item('a2', 1, 'Understand'), item('a3', 1, 'Understand'),
    item('a4', 1, 'Remember'), item('a5', 1, 'Remember'), item('a6', 1, 'Apply'),
    item('a7', 1, 'Apply'), item('a8', 1, 'Understand'), item('a9', 1, 'Remember'),
    item('a10', 1, 'Evaluate'),
    // Section B, 2 marks each
    item('b11', 2, 'Understand'), item('b12', 2, 'Understand'), item('b13', 2, 'Understand'),
    item('b14', 2, 'Remember'), item('b15', 2, 'Apply'),
    // Section C, 5 marks each
    item('c16', 5, 'Apply'), item('c17', 5, 'Evaluate'), item('c18', 5, 'Analyse'),
    item('c19', 5, 'Evaluate'), item('c20', 5, 'Analyse'),
    // Section D, 10 marks each
    item('d21', 10, 'Evaluate'), item('d22', 10, 'Analyse'), item('d23', 10, 'Analyse'),
  ];

  it('totals the marks each level carries, and its share of the paper', () => {
    const result = run({ items: collegePaper });
    expect(result.paperTotal).toBe(75);

    // Remember  1+1+1+1 + 2         =  6 →  6/75 =  8%
    // Understand 1+1+1 + 2+2+2      =  9 →  9/75 = 12%
    // Apply     1+1 + 2 + 5         =  9 →  9/75 = 12%
    // Analyse   5+5 + 10+10         = 30 → 30/75 = 40%
    // Evaluate  1 + 5+5 + 10        = 21 → 21/75 = 28%
    const by = Object.fromEntries(result.blueprint.map((r) => [r.level, r]));
    expect(by['Remember']).toMatchObject({ marksAllotted: 6, questionCount: 5 });
    expect(by['Understand']).toMatchObject({ marksAllotted: 9, questionCount: 6 });
    expect(by['Apply']).toMatchObject({ marksAllotted: 9, questionCount: 4 });
    expect(by['Analyse']).toMatchObject({ marksAllotted: 30, questionCount: 4 });
    expect(by['Evaluate']).toMatchObject({ marksAllotted: 21, questionCount: 4 });

    // 21/75 is 28% in decimal but 28.000000000000004 in binary floating
    // point, so the share is compared as a real number rather than for
    // exact equality. That is safe HERE and only here: a percentage in
    // this engine is a display value. No level is ever decided from one
    // — lookupBand is handed the marks themselves and cross-multiplies,
    // so a student exactly on 80% cannot be tipped to level 2 by the
    // last bit of a division.
    expect(by['Remember']!.expectedPercent).toBeCloseTo(8, 10);
    expect(by['Understand']!.expectedPercent).toBeCloseTo(12, 10);
    expect(by['Apply']!.expectedPercent).toBeCloseTo(12, 10);
    expect(by['Analyse']!.expectedPercent).toBeCloseTo(40, 10);
    expect(by['Evaluate']!.expectedPercent).toBeCloseTo(28, 10);
  });

  it('the shares sum to 100', () => {
    const total = run({ items: collegePaper }).blueprint.reduce((sum, r) => sum + (r.expectedPercent ?? 0), 0);
    expect(total).toBeCloseTo(100, 10);
  });

  it('reports the levels in the order asked for, not the order the paper happens to use', () => {
    expect(run({ items: collegePaper }).blueprint.map((r) => r.level)).toEqual(LEVELS);
  });

  it('a level the paper never examines is a measured 0% of the paper, and is flagged', () => {
    // 0% here is a real finding, not an absent value: this paper exists
    // and devotes none of itself to analysis. That is the opposite of
    // the STUDENT's figure for the same level, which is null — with no
    // marks allotted there is nothing to have earned a share of. Same
    // level, two different denominators, so two different answers.
    const result = run({ items: [item('q1', 10, 'Remember')] });
    const analyse = result.blueprint.find((r) => r.level === 'Analyse')!;
    expect(analyse.marksAllotted).toBe(0);
    expect(analyse.expectedPercent).toBe(0);
    expect(result.warnings.some((w) => w.code === 'KL_LEVEL_NOT_EXAMINED')).toBe(true);
  });

  it('an empty paper produces no shares at all rather than dividing by zero', () => {
    const result = run({ items: [] });
    expect(result.paperTotal).toBe(0);
    expect(result.blueprint.every((r) => r.expectedPercent === null)).toBe(true);
    expect(result.warnings.some((w) => w.code === 'KL_NO_TAGGED_ITEMS')).toBe(true);
  });

  it('excludes a question tagged outside the taxonomy, and says so', () => {
    // Silently dropping it would leave every share computed against a
    // paper total that does not match the paper.
    const result = run({ items: [item('q1', 10, 'Remember'), item('q2', 40, 'Synthesis')] });
    expect(result.paperTotal).toBe(10);
    expect(result.blueprint.find((r) => r.level === 'Remember')!.expectedPercent).toBe(100);
    const warning = result.warnings.find((w) => w.code === 'KL_LEVEL_UNKNOWN');
    expect(warning?.ref.itemId).toBe('q2');
  });
});

describe('one student against the paper', () => {
  const paper = [item('q1', 10, 'Remember'), item('q2', 10, 'Apply')];

  it('divides marks earned by marks the paper allotted', () => {
    // Remember 8/10 = 80% → level 3; Apply 5/10 = 50% → level 1.
    const result = run({ items: paper, studentIds: ['s1'], marks: { s1: { q1: 8, q2: 5 } } });
    const [row] = result.students;
    expect(row!.perLevel.find((r) => r.level === 'Remember')).toMatchObject({
      marksAwarded: 8,
      marksAllotted: 10,
      attainedPercent: 80,
      attainmentLevel: 3,
    });
    expect(row!.perLevel.find((r) => r.level === 'Apply')).toMatchObject({ attainedPercent: 50, attainmentLevel: 1 });
    expect(row!.overallPercent).toBe(65); // 13 of 20
  });

  it('a zero is a mark and counts; a blank is not a zero but still lowers the figure', () => {
    // THE distinction this system is built on, in the one place where a
    // blank stays in the denominator. Both students earn 0 of 10 at
    // Apply, so both read 0% — but the blank is reported as unattempted
    // marks, and the zero is not.
    const scored = run({ items: paper, studentIds: ['s1'], marks: { s1: { q1: 10, q2: 0 } } }).students[0]!;
    const blank = run({ items: paper, studentIds: ['s1'], marks: { s1: { q1: 10, q2: null } } }).students[0]!;

    const apply = (row: typeof scored) => row.perLevel.find((r) => r.level === 'Apply')!;
    expect(apply(scored)).toMatchObject({ marksAwarded: 0, marksUnattempted: 0, attainedPercent: 0 });
    expect(apply(blank)).toMatchObject({ marksAwarded: 0, marksUnattempted: 10, attainedPercent: 0 });

    // Neither is absent — each attempted something.
    expect(scored.absent).toBe(false);
    expect(blank.absent).toBe(false);
  });

  it('an absent key is the same fact as an explicit blank', () => {
    const explicit = run({ items: paper, studentIds: ['s1'], marks: { s1: { q1: 5, q2: null } } }).students[0]!;
    const missing = run({ items: paper, studentIds: ['s1'], marks: { s1: { q1: 5 } } }).students[0]!;
    expect(missing.perLevel).toEqual(explicit.perLevel);
  });

  it('a student who attempted nothing is absent, not a zero', () => {
    const result = run({ items: paper, studentIds: ['s1'], marks: { s1: { q1: null, q2: null } } });
    const row = result.students[0]!;
    expect(row.absent).toBe(true);
    // Their per-level figures are 0% by arithmetic, but the overall
    // figure is null: they have no measured attainment to report.
    expect(row.overallPercent).toBeNull();
    expect(result.absentStudentIds).toEqual(['s1']);
    expect(result.warnings.some((w) => w.code === 'KL_STUDENT_ABSENT')).toBe(true);
  });

  it('a student with no marks at all is absent rather than missing', () => {
    const result = run({ items: paper, studentIds: ['s1'], marks: {} });
    expect(result.students).toHaveLength(1);
    expect(result.students[0]!.absent).toBe(true);
  });

  it('says once, not forty times, that blanks stayed in the denominator', () => {
    const result = run({
      items: paper,
      studentIds: ['s1', 's2', 's3'],
      marks: { s1: { q1: 5 }, s2: { q1: 5 }, s3: { q1: 5, q2: 5 } },
    });
    const raised = result.warnings.filter((w) => w.code === 'KL_MARKS_UNATTEMPTED');
    expect(raised).toHaveLength(1);
    expect(raised[0]!.message).toContain('2 student(s)');
  });

  it('a level the paper does not examine is null for the student too', () => {
    const result = run({ items: [item('q1', 10, 'Remember')], studentIds: ['s1'], marks: { s1: { q1: 10 } } });
    const analyse = result.students[0]!.perLevel.find((r) => r.level === 'Analyse')!;
    expect(analyse.attainedPercent).toBeNull();
    expect(analyse.attainmentLevel).toBeNull();
  });
});

describe('the band boundaries (§4.2), exactly', () => {
  // The college's sheet gets this wrong: its
  //   =IF(D37>79,"3",IF(AND(D37>59,D37<80),"2",…))
  // awards level 3 to 79.5%, though the table it prints beside it says
  // 60–79 → 2. The engine bands on ≥80, so the same figure is a 2.
  const at = (awarded: number, allotted: number) =>
    run({
      items: [item('q1', allotted, 'Remember')],
      studentIds: ['s1'],
      marks: { s1: { q1: awarded } },
    }).students[0]!.perLevel[0]!;

  it('exactly 80% is level 3', () => {
    expect(at(80, 100)).toMatchObject({ attainedPercent: 80, attainmentLevel: 3 });
    expect(at(4, 5)).toMatchObject({ attainedPercent: 80, attainmentLevel: 3 });
  });

  it('exactly 60% is level 2, and exactly 40% is level 1', () => {
    expect(at(60, 100)).toMatchObject({ attainedPercent: 60, attainmentLevel: 2 });
    expect(at(3, 5)).toMatchObject({ attainedPercent: 60, attainmentLevel: 2 });
    expect(at(40, 100)).toMatchObject({ attainedPercent: 40, attainmentLevel: 1 });
    expect(at(2, 5)).toMatchObject({ attainedPercent: 40, attainmentLevel: 1 });
  });

  it('a hair below each bound falls to the band beneath', () => {
    expect(at(79.5, 100).attainmentLevel).toBe(2); // the sheet says 3 — this is the fault
    expect(at(59.5, 100).attainmentLevel).toBe(1);
    expect(at(39.5, 100).attainmentLevel).toBe(0);
  });

  it('the extremes', () => {
    expect(at(100, 100)).toMatchObject({ attainedPercent: 100, attainmentLevel: 3 });
    expect(at(0, 100)).toMatchObject({ attainedPercent: 0, attainmentLevel: 0 });
  });

  it('a quarter-mark boundary is decided exactly, not by floating point', () => {
    // 3.5 of 7 is 50%; 5.6 of 7 is exactly 80%.
    expect(at(3.5, 7).attainmentLevel).toBe(1);
    expect(at(5.6, 7)).toMatchObject({ attainmentLevel: 3 });
  });

  it('levels are integers, never strings', () => {
    // The workbook returns "3" in quotes — text that averages wrongly
    // against a numeric 2. §9 lists this as a spreadsheet fault.
    const level = at(90, 100).attainmentLevel;
    expect(typeof level).toBe('number');
    expect(level).toBe(3);
  });
});

describe('the class', () => {
  const paper = [item('q1', 10, 'Remember'), item('q2', 10, 'Apply')];

  it('counts over the class’s marks, and bands the result the same way', () => {
    // Remember: (8 + 6) of 20 = 70% → level 2.
    // Apply:    (9 + 9) of 20 = 90% → level 3.
    const result = run({
      items: paper,
      studentIds: ['s1', 's2'],
      marks: { s1: { q1: 8, q2: 9 }, s2: { q1: 6, q2: 9 } },
    });
    const by = Object.fromEntries(result.cohort.map((r) => [r.level, r]));
    expect(by['Remember']).toMatchObject({ marksAwarded: 14, marksAllotted: 20, attainedPercent: 70, attainmentLevel: 2 });
    expect(by['Apply']).toMatchObject({ attainedPercent: 90, attainmentLevel: 3 });
  });

  it('excludes an absent student rather than letting them drag the class down', () => {
    // s2 sat nothing. The class figure is s1 alone: 8 of 10 = 80% → 3.
    // Counting s2 would give 8 of 20 = 40% → 1, which describes nobody.
    const result = run({
      items: [item('q1', 10, 'Remember')],
      studentIds: ['s1', 's2'],
      marks: { s1: { q1: 8 }, s2: {} },
    });
    const remember = result.cohort.find((r) => r.level === 'Remember')!;
    expect(remember.studentsCounted).toBe(1);
    expect(remember).toMatchObject({ marksAllotted: 10, marksAwarded: 8, attainedPercent: 80, attainmentLevel: 3 });
  });

  it('a student who left questions blank still counts — only total absence excludes', () => {
    // s2 attempted one question of two, so they are present. Remember:
    // (8 + 0) of 20 = 40% → 1.
    const result = run({
      items: paper,
      studentIds: ['s1', 's2'],
      marks: { s1: { q1: 8, q2: 5 }, s2: { q1: null, q2: 5 } },
    });
    const remember = result.cohort.find((r) => r.level === 'Remember')!;
    expect(remember.studentsCounted).toBe(2);
    expect(remember).toMatchObject({ attainedPercent: 40, attainmentLevel: 1 });
  });

  it('reports how the class spread across the four levels', () => {
    // Remember: s1 10/10 = 100% → 3; s2 7/10 = 70% → 2; s3 2/10 = 20% → 0.
    const result = run({
      items: [item('q1', 10, 'Remember')],
      studentIds: ['s1', 's2', 's3'],
      marks: { s1: { q1: 10 }, s2: { q1: 7 }, s3: { q1: 2 } },
    });
    expect(result.cohort[0]!.distribution).toEqual({ 0: 1, 1: 0, 2: 1, 3: 1 });
  });

  it('a class where nobody sat the paper has no figures, and says so', () => {
    const result = run({ items: paper, studentIds: ['s1', 's2'], marks: {} });
    expect(result.cohort.every((r) => r.attainedPercent === null || r.marksAllotted === 0)).toBe(true);
    expect(result.warnings.some((w) => w.code === 'KL_NO_STUDENTS_PRESENT')).toBe(true);
  });

  it('a course with no students at all is not an error', () => {
    const result = run({ items: paper, studentIds: [] });
    expect(result.students).toEqual([]);
    expect(result.warnings.some((w) => w.code === 'KL_NO_STUDENTS_PRESENT')).toBe(false);
  });
});

describe('invariants', () => {
  it('refuses a question worth nothing', () => {
    expect(() => run({ items: [item('q1', 0, 'Remember')] })).toThrow(/non-positive maximum mark/);
  });

  it('throws rather than reporting a percentage outside [0, 100]', () => {
    // A mark above the item maximum should never reach here — mark entry
    // validates against it — but if it did, §9 requires a thrown error,
    // not a 150% attainment quietly printed on a filed report.
    expect(() =>
      run({ items: [item('q1', 10, 'Remember')], studentIds: ['s1'], marks: { s1: { q1: 15 } } }),
    ).toThrow(EngineAssertionError);
  });

  it('does not touch the ten steps: no CO or PO appears anywhere in the result', () => {
    const result = run({ items: [item('q1', 10, 'Remember')], studentIds: ['s1'], marks: { s1: { q1: 5 } } });
    expect(JSON.stringify(result)).not.toMatch(/\bco(Id|Tag)\b|\bpoId\b/i);
  });
});
