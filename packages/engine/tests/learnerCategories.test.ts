import { describe, expect, it } from 'vitest';
import {
  computeLearnerCategories,
  DEFAULT_CATEGORY_BANDS,
  type CategoryBandRow,
  type LearnerCategoryInput,
  type LearnerCourseRatings,
  type LearnerCriterion,
} from '../src/learnerCategories';

/**
 * Slow and advanced learners (NAAC 2.2.1).
 *
 * Every figure below was worked out by hand before the assertion was
 * written, from synthetic students. The college's filed workbook is used
 * as a statement of the METHOD and never as an oracle for a number — five
 * of its numbers are demonstrably wrong, and the last five tests here
 * exist precisely because of them.
 */

const C = (id: string, label: string, derived = false): LearnerCriterion => ({
  id,
  label,
  maxScore: 20,
  derived,
});

/** The Mathematics department's five, each out of 20 → 100 in total. */
const FIVE: LearnerCriterion[] = [
  C('interaction', 'Interaction with teachers'),
  C('flipped', 'Flipped learning'),
  C('seminar', 'Seminar'),
  C('self', 'Interest shown towards self-learning'),
  C('weightage', 'Weightage — CIA & semester', true),
];

/** A subject where everyone scores the same on everything. */
function flatCourse(courseId: string, studentIds: string[], score: number): LearnerCourseRatings {
  return {
    courseId,
    courseTitle: courseId,
    studentIds,
    scores: Object.fromEntries(
      studentIds.map((sid) => [sid, Object.fromEntries(FIVE.map((c) => [c.id, score]))]),
    ),
  };
}

function run(partial: Partial<LearnerCategoryInput> & Pick<LearnerCategoryInput, 'courses' | 'studentIds'>) {
  return computeLearnerCategories({
    criteria: FIVE,
    bands: [...DEFAULT_CATEGORY_BANDS],
    ...partial,
  });
}

const of = (r: ReturnType<typeof run>, studentId: string) =>
  r.students.find((s) => s.studentId === studentId)!;

// ── the arithmetic ────────────────────────────────────────────────────────

describe('the semester score', () => {
  it('averages each criterion across subjects, then sums the averages', () => {
    // Two subjects. Interaction 18 and 14 → 16; flipped 20 and 16 → 18;
    // seminar 19 and 15 → 17; self 19 and 13 → 16; weightage 17 and 11 → 14.
    // Total 16 + 18 + 17 + 16 + 14 = 81 out of 100.
    const s = ['s1'];
    const a: LearnerCourseRatings = {
      courseId: 'a',
      courseTitle: 'Algebra',
      studentIds: s,
      scores: { s1: { interaction: 18, flipped: 20, seminar: 19, self: 19, weightage: 17 } },
    };
    const b: LearnerCourseRatings = {
      courseId: 'b',
      courseTitle: 'Calculus',
      studentIds: s,
      scores: { s1: { interaction: 14, flipped: 16, seminar: 15, self: 13, weightage: 11 } },
    };

    const row = of(run({ courses: [a, b], studentIds: s }), 's1');
    expect(row.perCriterion.map((c) => c.mean)).toEqual([16, 18, 17, 16, 14]);
    expect(row.totalScore).toBe(81);
    expect(row.obtainableScore).toBe(100);
    expect(row.finalPercent).toBe(81);
    expect(row.category).toBe('Advanced');
  });

  it('divides by three when the student took three subjects', () => {
    // 20, 17 and 14 on every criterion → mean 17 each → 85 in total.
    const s = ['s1'];
    const r = run({
      courses: [flatCourse('a', s, 20), flatCourse('b', s, 17), flatCourse('c', s, 14)],
      studentIds: s,
    });
    expect(of(r, 's1').perCriterion.every((c) => c.mean === 17)).toBe(true);
    expect(of(r, 's1').totalScore).toBe(85);
  });

  it('reports the divisor it actually used', () => {
    const s = ['s1'];
    const rated = flatCourse('a', s, 18);
    const unrated: LearnerCourseRatings = { courseId: 'b', courseTitle: 'B', studentIds: s, scores: {} };
    const row = of(run({ courses: [rated, unrated], studentIds: s }), 's1');
    expect(row.coursesTaken).toBe(2);
    expect(row.perCriterion[0]!.ratedIn).toBe(1);
    expect(row.perCriterion[0]!.unratedIn).toBe(1);
  });
});

// ── blank is not zero ─────────────────────────────────────────────────────

describe('blank is not zero', () => {
  it('an unrated subject leaves the divisor, it does not score nought', () => {
    // Rated 18 in one subject, not rated in the other. The mean is 18,
    // NOT (18 + 0) / 2 = 9 — which is what the workbook's /2 would give.
    const s = ['s1'];
    const rated = flatCourse('a', s, 18);
    const unrated: LearnerCourseRatings = {
      courseId: 'b',
      courseTitle: 'B',
      studentIds: s,
      scores: { s1: { interaction: null, flipped: null, seminar: null, self: null, weightage: null } },
    };
    expect(of(run({ courses: [rated, unrated], studentIds: s }), 's1').totalScore).toBe(90);
  });

  it('a rating of zero is a real rating and is counted', () => {
    // 18 and 0 → mean 9 per criterion → 45. Distinct from the case above.
    const s = ['s1'];
    const r = run({ courses: [flatCourse('a', s, 18), flatCourse('b', s, 0)], studentIds: s });
    expect(of(r, 's1').totalScore).toBe(45);
    expect(of(r, 's1').perCriterion[0]!.ratedIn).toBe(2);
  });

  it('scores out of the criteria that were rated, not out of the full set', () => {
    // Four of five criteria rated at 15 → 60 out of 80 = 75%, which is
    // Advanced. Scored out of 100 it would be 60% — Average — and the
    // missing rating would have read as a failing one.
    const s = ['s1'];
    const course: LearnerCourseRatings = {
      courseId: 'a',
      courseTitle: 'A',
      studentIds: s,
      scores: { s1: { interaction: 15, flipped: 15, seminar: 15, self: 15, weightage: null } },
    };
    const row = of(run({ courses: [course], studentIds: s }), 's1');
    expect(row.totalScore).toBe(60);
    expect(row.obtainableScore).toBe(80);
    expect(row.finalPercent).toBe(75);
    expect(row.category).toBe('Advanced');
    expect(row.partiallyRated).toBe(true);
  });

  it('leaves a student with no rating anywhere unclassified, never "slow"', () => {
    const s = ['s1'];
    const r = run({
      courses: [{ courseId: 'a', courseTitle: 'A', studentIds: s, scores: {} }],
      studentIds: s,
    });
    expect(of(r, 's1').category).toBeNull();
    expect(of(r, 's1').totalScore).toBeNull();
    expect(r.unclassifiedStudentIds).toEqual(['s1']);
    expect(r.warnings.map((w) => w.code)).toContain('LC_STUDENT_UNRATED');
  });

  it('a student enrolled in nothing is reported, not scored', () => {
    const r = run({ courses: [flatCourse('a', ['s1'], 18)], studentIds: ['s1', 's2'] });
    expect(of(r, 's2').coursesTaken).toBe(0);
    expect(of(r, 's2').category).toBeNull();
    expect(r.warnings.map((w) => w.code)).toContain('LC_NOT_ENROLLED');
  });
});

// ── the marks alone are not a classification ──────────────────────────────

describe('a student nobody has judged', () => {
  /** Only the derived criterion has a value — the state of every student before a teacher opens the sheet. */
  const marksOnly = (weightage: number): LearnerCourseRatings => ({
    courseId: 'a',
    courseTitle: 'A',
    studentIds: ['s1'],
    scores: { s1: { weightage } },
  });

  it('is left unclassified even though the derived figure would place them', () => {
    // 13.7 of 20 is 68.5% — "Average" on the band table. Reporting that
    // would label every unjudged student in the college on their marks.
    const row = of(run({ courses: [marksOnly(13.7)], studentIds: ['s1'] }), 's1');
    expect(row.category).toBeNull();
    expect(row.judgedCriteria).toBe(0);
  });

  it('still shows the figures, so the sheet says what IS known', () => {
    const row = of(run({ courses: [marksOnly(13.7)], studentIds: ['s1'] }), 's1');
    expect(row.totalScore).toBeCloseTo(13.7, 9);
    expect(row.obtainableScore).toBe(20);
    expect(row.finalPercent).toBeCloseTo(68.5, 9);
  });

  it('is reported as unjudged, distinctly from having nothing at all', () => {
    const r = run({ courses: [marksOnly(13.7)], studentIds: ['s1'] });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('LC_NOT_JUDGED');
    expect(codes).not.toContain('LC_STUDENT_UNRATED');
  });

  it('and one with nothing at all is reported the other way', () => {
    const r = run({
      courses: [{ courseId: 'a', courseTitle: 'A', studentIds: ['s1'], scores: {} }],
      studentIds: ['s1'],
    });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain('LC_STUDENT_UNRATED');
    expect(codes).not.toContain('LC_NOT_JUDGED');
  });

  it('becomes classifiable the moment ONE judgement is entered', () => {
    const course: LearnerCourseRatings = {
      courseId: 'a',
      courseTitle: 'A',
      studentIds: ['s1'],
      scores: { s1: { weightage: 13.7, interaction: 18 } },
    };
    const row = of(run({ courses: [course], studentIds: ['s1'] }), 's1');
    expect(row.judgedCriteria).toBe(1);
    expect(row.totalScore).toBeCloseTo(31.7, 9); // out of 40 = 79.25%
    expect(row.category).toBe('Advanced');
  });

  it('is excluded from the counts, so the cohort is not described by its marks', () => {
    const ids = ['judged', 'unjudged'];
    const course: LearnerCourseRatings = {
      courseId: 'a',
      courseTitle: 'A',
      studentIds: ids,
      scores: {
        judged: Object.fromEntries(FIVE.map((c) => [c.id, 18])),
        unjudged: { weightage: 10 },
      },
    };
    const r = run({ courses: [course], studentIds: ids });
    expect(r.counts.find((c) => c.category === 'Advanced')).toEqual({
      category: 'Advanced',
      students: 1,
      percent: 100,
    });
    expect(r.unclassifiedStudentIds).toEqual(['unjudged']);
  });

  it('but a programme with ONLY derived criteria gets the computed classification it asked for', () => {
    const criteria: LearnerCriterion[] = [{ id: 'weightage', label: 'Weightage', maxScore: 20, derived: true }];
    const r = computeLearnerCategories({
      criteria,
      courses: [marksOnly(16)],
      studentIds: ['s1'],
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    expect(of(r, 's1').category).toBe('Advanced'); // 80%
  });
});

// ── boundaries ────────────────────────────────────────────────────────────

describe('the category boundaries are inclusive', () => {
  const s = ['s1'];
  const at = (score: number) => of(run({ courses: [flatCourse('a', s, score)], studentIds: s }), 's1');

  it('exactly 75 is Advanced, not Average', () => {
    expect(at(15).totalScore).toBe(75);
    expect(at(15).category).toBe('Advanced');
  });

  it('a hair below 75 is Average', () => {
    expect(at(14.95).category).toBe('Average'); // 74.75
  });

  it('exactly 60 is Average, not Slow', () => {
    expect(at(12).totalScore).toBe(60);
    expect(at(12).category).toBe('Average');
  });

  it('a hair below 60 is Slow', () => {
    expect(at(11.95).category).toBe('Slow'); // 59.75
  });

  it('zero lands on Slow rather than falling off the table', () => {
    expect(at(0).totalScore).toBe(0);
    expect(at(0).category).toBe('Slow');
  });

  it('full marks land on the top category', () => {
    expect(at(20).totalScore).toBe(100);
    expect(at(20).category).toBe('Advanced');
  });

  it('holds on a boundary reached only through an average', () => {
    // 16 and 14 → 15 per criterion → exactly 75.
    const r = run({ courses: [flatCourse('a', s, 16), flatCourse('b', s, 14)], studentIds: s });
    expect(of(r, 's1').totalScore).toBe(75);
    expect(of(r, 's1').category).toBe('Advanced');
  });
});

// ── the cohort ────────────────────────────────────────────────────────────

describe('the counts', () => {
  it('counts each category and gives its share of the classified', () => {
    const s = ['a1', 'a2', 'v1', 'l1'];
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: s,
      scores: {
        a1: Object.fromEntries(FIVE.map((c) => [c.id, 18])), // 90 Advanced
        a2: Object.fromEntries(FIVE.map((c) => [c.id, 16])), // 80 Advanced
        v1: Object.fromEntries(FIVE.map((c) => [c.id, 13])), // 65 Average
        l1: Object.fromEntries(FIVE.map((c) => [c.id, 10])), // 50 Slow
      },
    };
    const r = run({ courses: [course], studentIds: s });
    expect(r.counts).toEqual([
      { category: 'Advanced', students: 2, percent: 50 },
      { category: 'Average', students: 1, percent: 25 },
      { category: 'Slow', students: 1, percent: 25 },
    ]);
  });

  it('excludes unclassified students from the shares', () => {
    // Three rated (2 Advanced, 1 Slow) and one not. The Advanced share is
    // 2/3, not 2/4 — an unrated student must not dilute the finding.
    const s = ['a1', 'a2', 'l1', 'x1'];
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: s,
      scores: {
        a1: Object.fromEntries(FIVE.map((c) => [c.id, 18])),
        a2: Object.fromEntries(FIVE.map((c) => [c.id, 16])),
        l1: Object.fromEntries(FIVE.map((c) => [c.id, 10])),
      },
    };
    const r = run({ courses: [course], studentIds: s });
    expect(r.counts.find((c) => c.category === 'Advanced')!.percent).toBeCloseTo(66.666666, 5);
    expect(r.unclassifiedStudentIds).toEqual(['x1']);
  });

  it('reports no share at all when nobody is classified', () => {
    const r = run({ courses: [{ courseId: 'c', courseTitle: 'C', studentIds: ['s1'], scores: {} }], studentIds: ['s1'] });
    expect(r.counts.every((c) => c.students === 0 && c.percent === null)).toBe(true);
  });
});

// ── configuration ─────────────────────────────────────────────────────────

describe('configuration', () => {
  it("accepts a department's own criteria and maxima", () => {
    const criteria: LearnerCriterion[] = [
      { id: 'x', label: 'X', maxScore: 10, derived: false },
      { id: 'y', label: 'Y', maxScore: 40, derived: false },
    ];
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: ['s1'],
      scores: { s1: { x: 8, y: 30 } },
    };
    const r = computeLearnerCategories({
      criteria,
      courses: [course],
      studentIds: ['s1'],
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    expect(r.fullObtainableScore).toBe(50);
    expect(of(r, 's1').totalScore).toBe(38); // 76% → Advanced
    expect(of(r, 's1').category).toBe('Advanced');
  });

  it('accepts the college\'s two-category scheme if it insists on it', () => {
    const bands: CategoryBandRow[] = [
      { lowerPercent: 70, category: 'AL' },
      { lowerPercent: 0, category: 'SL' },
    ];
    const s = ['s1'];
    const r = run({ courses: [flatCourse('a', s, 14)], studentIds: s, bands });
    expect(of(r, 's1').category).toBe('AL'); // exactly 70
  });

  it('refuses a band table with no floor, rather than silently unclassifying', () => {
    expect(() =>
      run({ courses: [], studentIds: [], bands: [{ lowerPercent: 40, category: 'Pass' }] }),
    ).toThrow(/no row at 0/);
  });

  it('refuses a criterion with a non-positive maximum', () => {
    expect(() =>
      computeLearnerCategories({
        criteria: [{ id: 'x', label: 'X', maxScore: 0, derived: false }],
        courses: [],
        studentIds: [],
        bands: [...DEFAULT_CATEGORY_BANDS],
      }),
    ).toThrow(/non-positive maximum/);
  });

  it('refuses a rating above the criterion maximum', () => {
    // A contract violation, not a figure — so it throws rather than
    // producing a percentage above 100. Reachable only by lowering a
    // maximum after ratings were entered, which the write path refuses
    // and the reader filters out (see apps/web/lib/learnerCategories.ts);
    // this is the backstop behind both.
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: ['s1'],
      scores: { s1: { interaction: 25 } },
    };
    expect(() => run({ courses: [course], studentIds: ['s1'] })).toThrow(/outside 0\.\.20/);
  });

  it('refuses a negative rating too', () => {
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: ['s1'],
      scores: { s1: { interaction: -1 } },
    };
    expect(() => run({ courses: [course], studentIds: ['s1'] })).toThrow(/outside 0\.\.20/);
  });

  it('warns when no criteria are configured', () => {
    const r = computeLearnerCategories({
      criteria: [],
      courses: [],
      studentIds: ['s1'],
      bands: [...DEFAULT_CATEGORY_BANDS],
    });
    expect(r.warnings.map((w) => w.code)).toContain('LC_NO_CRITERIA');
    expect(of(r, 's1').category).toBeNull();
  });

  it('names a subject in which nobody has been rated', () => {
    const r = run({
      courses: [flatCourse('a', ['s1'], 18), { courseId: 'b', courseTitle: 'Topology', studentIds: ['s1'], scores: {} }],
      studentIds: ['s1'],
    });
    const w = r.warnings.find((x) => x.code === 'LC_COURSE_UNRATED');
    expect(w?.message).toMatch(/Topology/);
    expect(w?.ref.courseId).toBe('b');
  });
});

// ── regressions: the five faults in the filed workbook ────────────────────

describe('the faults in the filed workbook', () => {
  it('fault 1: a score belongs to the student it was computed from', () => {
    // FinalSem1!I6 is =SUM(D10+E10+F10+G10+H10) — shared to I18, so rows
    // 6-18 each display the score of the student four rows below. The two
    // highest scorers in the semester are on file as slow learners.
    //
    // Reproduced with the shape that made it possible: seventeen students
    // whose scores differ, in roster order. Every one must be its own.
    const ids = Array.from({ length: 17 }, (_, i) => `s${i + 1}`);
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: ids,
      // s1 → 1 on every criterion (5 in total), s2 → 2 (10), …, s17 → 85.
      scores: Object.fromEntries(
        ids.map((id, i) => [id, Object.fromEntries(FIVE.map((c) => [c.id, i + 1]))]),
      ),
    };
    const r = run({ courses: [course], studentIds: ids });
    for (const [i, id] of ids.entries()) {
      expect(of(r, id).totalScore).toBe((i + 1) * 5);
    }
    // The offset that did the damage: no student carries the score of the
    // student four places later.
    for (let i = 0; i + 4 < ids.length; i++) {
      expect(of(r, ids[i]!).totalScore).not.toBe(of(r, ids[i + 4]!).totalScore);
    }
  });

  it('fault 2: one score cannot yield two categories', () => {
    // In the filed sheet 84.6 is labelled "AL" on one row and "SL" on
    // another, because the label is typed rather than derived.
    const ids = ['p', 'q'];
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: ids,
      scores: {
        // Same total of 84.6, reached differently: 18+18+18+18+12.6 and
        // 16.92 on all five.
        p: { interaction: 18, flipped: 18, seminar: 18, self: 18, weightage: 12.6 },
        q: Object.fromEntries(FIVE.map((c) => [c.id, 16.92])),
      },
    };
    const r = run({ courses: [course], studentIds: ids });
    expect(of(r, 'p').totalScore).toBeCloseTo(84.6, 9);
    expect(of(r, 'q').totalScore).toBeCloseTo(84.6, 9);
    expect(of(r, 'p').category).toBe(of(r, 'q').category);
  });

  it('fault 4: nothing is rounded inside the arithmetic', () => {
    // FinalSem2!D22 alone is wrapped in ROUND(...,0): (15+16+16)/3 = 15.667
    // becomes 16, giving that student a third of a mark nobody else gets.
    const s = ['s1'];
    const courses = [15, 16, 16].map((v, i) => ({
      courseId: `c${i}`,
      courseTitle: `C${i}`,
      studentIds: s,
      scores: { s1: { interaction: v, flipped: v, seminar: v, self: v, weightage: v } },
    }));
    const row = of(run({ courses, studentIds: s }), 's1');
    expect(row.perCriterion[0]!.mean).toBeCloseTo(15.6666666, 6);
    expect(row.perCriterion[0]!.mean).not.toBe(16);
    expect(row.totalScore).toBeCloseTo(78.333333, 5);
  });

  it('fault 5: the divisor is the ratings, never a hard-coded subject count', () => {
    // The sheet divides by 2 in Semester 1 and by 3 in Semester 2 whether
    // or not the student took them all. Here a student who took two of the
    // three is divided by two.
    const all = ['s1', 's2'];
    const courses = [
      flatCourse('a', all, 18),
      flatCourse('b', all, 12),
      flatCourse('c', ['s2'], 6), // s1 did not take this one
    ];
    const r = run({ courses, studentIds: all });
    expect(of(r, 's1').perCriterion[0]!.mean).toBe(15); // (18+12)/2
    expect(of(r, 's1').totalScore).toBe(75);
    expect(of(r, 's2').perCriterion[0]!.mean).toBe(12); // (18+12+6)/3
    expect(of(r, 's2').totalScore).toBe(60);
  });

  it('fault 7: three categories keep the middle visible', () => {
    // The filed Semester 1 puts 13 of 17 students in "slow" for want of a
    // middle band. The same cohort, banded three ways, separates.
    const ids = ['a', 'b', 'c'];
    const course: LearnerCourseRatings = {
      courseId: 'c',
      courseTitle: 'C',
      studentIds: ids,
      scores: {
        a: Object.fromEntries(FIVE.map((x) => [x.id, 16])), // 80 Advanced
        b: Object.fromEntries(FIVE.map((x) => [x.id, 14])), // 70 Average
        c: Object.fromEntries(FIVE.map((x) => [x.id, 11])), // 55 Slow
      },
    };
    const r = run({ courses: [course], studentIds: ids });
    expect(r.counts.map((x) => x.students)).toEqual([1, 1, 1]);
  });
});

// ── the engine's own invariants ───────────────────────────────────────────

describe('invariants', () => {
  it('stores nothing and is a pure function of its input', () => {
    const s = ['s1'];
    const input: LearnerCategoryInput = {
      criteria: FIVE,
      courses: [flatCourse('a', s, 17)],
      studentIds: s,
      bands: [...DEFAULT_CATEGORY_BANDS],
    };
    expect(computeLearnerCategories(input)).toEqual(computeLearnerCategories(input));
  });

  it('does not mutate the band table it is given', () => {
    const bands: CategoryBandRow[] = [
      { lowerPercent: 0, category: 'Slow' },
      { lowerPercent: 75, category: 'Advanced' },
    ];
    const before = JSON.stringify(bands);
    run({ courses: [flatCourse('a', ['s1'], 17)], studentIds: ['s1'], bands });
    expect(JSON.stringify(bands)).toBe(before);
  });

  it('holds every percentage inside [0, 100]', () => {
    const s = ['s1'];
    const r = run({ courses: [flatCourse('a', s, 20), flatCourse('b', s, 0)], studentIds: s });
    for (const student of r.students) {
      if (student.finalPercent !== null) {
        expect(student.finalPercent).toBeGreaterThanOrEqual(0);
        expect(student.finalPercent).toBeLessThanOrEqual(100);
      }
    }
  });
});
