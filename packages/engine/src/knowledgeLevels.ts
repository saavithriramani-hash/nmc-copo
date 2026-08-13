import { assertPercentInRange } from './assert';
import { lookupBand } from './steps/step3ItemScores';
import type { BandRow, EngineWarning, Level } from './types';
import { makeWarning } from './util';

/**
 * Learning outcome by knowledge level — the college's "Expected (QP) and
 * Actual (marks obtained by a student)" workbook, as filed in
 * `docs/Personal Copy of Learning Outcome_…xlsx`.
 *
 * STANDALONE, AND DELIBERATELY SO. This is not one of the ten steps and
 * feeds none of them. `computeCourse` neither calls it nor is affected by
 * it: CO and PO/PSO attainment are exactly what the Procedure defines,
 * before and after this file existed. It answers a different question —
 * not "was the outcome attained?" but "of the marks this paper allotted
 * to remembering, to applying, to analysing, how many did the student
 * actually earn?"
 *
 * TWO MEASUREMENTS, ONE BAND TABLE. The blueprint is the paper's design
 * intent: the share of the paper given to each knowledge level, which
 * exists before a single student sits the examination and is worth
 * reading on its own — it tells the paper-setter whether the paper they
 * have written matches the balance they intended. The attainment is what
 * a student earned against those allotments.
 *
 * THE DENOMINATOR IS THE PAPER, NOT THE ATTEMPT. This is the one place in
 * the system where a blank does not leave the denominator. Elsewhere
 * "did not attempt" is excluded, because a cohort statistic must not be
 * distorted by absence. Here the college's sheet divides by the marks the
 * paper allotted, so a question left blank lowers the student's figure —
 * and that is the intended meaning: an outcome you did not demonstrate is
 * not an outcome you attained. Blank still is not zero in the data: the
 * marks left unattempted are counted and reported separately
 * (`marksUnattempted`), a student who attempted nothing is reported as
 * absent rather than as having scored nothing, and the cohort roll-up
 * excludes those students entirely.
 */

/** One tagged question. Items with no knowledge level are not passed in. */
export interface KnowledgeItem {
  id: string;
  /** Maximum obtainable mark. Must be > 0. */
  maxMark: number;
  /** The knowledge level this question examines. */
  level: string;
}

export interface KnowledgeLevelInput {
  /**
   * The levels to report, in the order they should appear. Given by the
   * caller rather than derived from the items, so a level the paper
   * ignores is still visible as a gap in the blueprint — that a paper
   * examines no analysis at all is a finding, not an empty column.
   */
  levels: string[];
  items: KnowledgeItem[];
  /** studentId → itemId → mark. `null`, or an absent key, = did not attempt. */
  marks: Record<string, Record<string, number | null>>;
  /**
   * Every student the paper was set for, including any who sat none of
   * it. Passed explicitly so absence is representable: a student missing
   * from `marks` is absent, not non-existent.
   */
  studentIds: string[];
  /**
   * Percentage → level. The same table §4.2 uses, and the same one the
   * college's sheet states (80/60/40). Note what it is being fed: §4.2
   * gives it a proportion of *students*, this gives it a proportion of
   * *marks*. One mapping from a percentage to a level, two things
   * measured — reused so the college maintains one table, not two.
   */
  bands: BandRow[];
}

/** The paper's design intent for one knowledge level. */
export interface BlueprintRow {
  level: string;
  questionCount: number;
  marksAllotted: number;
  /**
   * Share of the whole paper, as a percentage. `null` when the paper
   * carries no marks at all — never 0, which would claim the level was
   * deliberately excluded from a paper that does not exist.
   */
  expectedPercent: number | null;
}

/** What one student earned at one knowledge level. */
export interface StudentLevelRow {
  level: string;
  marksAllotted: number;
  marksAwarded: number;
  /** Allotted on questions this student left blank. Never counted as zero. */
  marksUnattempted: number;
  /** `null` when the paper allotted this level nothing — not 0%. */
  attainedPercent: number | null;
  attainmentLevel: Level | null;
}

export interface StudentKnowledgeRow {
  studentId: string;
  /** True when the student attempted nothing at all in the paper. */
  absent: boolean;
  perLevel: StudentLevelRow[];
  marksAllotted: number;
  marksAwarded: number;
  /** `null` for an absent student: they have no measured figure. */
  overallPercent: number | null;
}

/** The class as a whole, at one knowledge level. Absentees excluded. */
export interface CohortLevelRow {
  level: string;
  /** Students counted — those who attempted at least one question. */
  studentsCounted: number;
  marksAllotted: number;
  marksAwarded: number;
  attainedPercent: number | null;
  attainmentLevel: Level | null;
  /** How many present students landed on each level, 0 → 3. */
  distribution: Record<Level, number>;
}

export interface KnowledgeLevelResult {
  blueprint: BlueprintRow[];
  /** Total marks carried by the tagged questions. */
  paperTotal: number;
  students: StudentKnowledgeRow[];
  cohort: CohortLevelRow[];
  /** Students who attempted nothing; excluded from every cohort figure. */
  absentStudentIds: string[];
  warnings: EngineWarning[];
}

/**
 * A percentage of marks, or null when nothing was allotted.
 *
 * Guards the zero denominator the college's sheet does not: with a level
 * the paper never examines, its `=D36/C36*100` is a `#DIV/0!` in the
 * filed document.
 */
function percentOrNull(part: number, whole: number, context: string): number | null {
  if (whole <= 0) return null;
  const pct = (part / whole) * 100;
  assertPercentInRange(pct, context);
  return pct;
}

export function computeKnowledgeLevels(input: KnowledgeLevelInput): KnowledgeLevelResult {
  const { levels, items, marks, studentIds, bands } = input;
  const warnings: EngineWarning[] = [];

  for (const item of items) {
    if (!(item.maxMark > 0)) {
      throw new Error(`item ${item.id} has a non-positive maximum mark (${item.maxMark})`);
    }
  }

  // Items whose level is not one the caller asked to report would vanish
  // silently from the paper total, making every share wrong. Kept out and
  // named instead.
  const known = new Set(levels);
  const stray = items.filter((item) => !known.has(item.level));
  const counted = items.filter((item) => known.has(item.level));
  for (const item of stray) {
    warnings.push(
      makeWarning(
        'KL_LEVEL_UNKNOWN',
        'warning',
        `Question is tagged '${item.level}', which is not a knowledge level of this taxonomy; it is excluded from the learning-outcome figures.`,
        { itemId: item.id },
      ),
    );
  }

  const itemsAt = (level: string) => counted.filter((item) => item.level === level);
  const paperTotal = counted.reduce((sum, item) => sum + item.maxMark, 0);

  // ── the blueprint: what the paper set out to examine ──
  const blueprint: BlueprintRow[] = levels.map((level) => {
    const at = itemsAt(level);
    const marksAllotted = at.reduce((sum, item) => sum + item.maxMark, 0);
    if (at.length === 0) {
      warnings.push(
        makeWarning(
          'KL_LEVEL_NOT_EXAMINED',
          'info',
          `The paper allots no marks to '${level}'; no attainment can be computed for it and none is reported as zero.`,
          {},
        ),
      );
    }
    return {
      level,
      questionCount: at.length,
      marksAllotted,
      expectedPercent: percentOrNull(marksAllotted, paperTotal, `expected share of '${level}'`),
    };
  });

  if (counted.length === 0) {
    warnings.push(
      makeWarning('KL_NO_TAGGED_ITEMS', 'warning', 'No question carries a knowledge level, so nothing can be measured.', {}),
    );
  }

  // ── per student ──
  const students: StudentKnowledgeRow[] = studentIds.map((studentId) => {
    const row = marks[studentId] ?? {};
    let attemptedAnything = false;

    const perLevel: StudentLevelRow[] = levels.map((level) => {
      const at = itemsAt(level);
      let marksAllotted = 0;
      let marksAwarded = 0;
      let marksUnattempted = 0;

      for (const item of at) {
        marksAllotted += item.maxMark;
        const mark = row[item.id];
        // Blank and absent-key are the same fact; zero is a real mark and
        // is neither. The distinction is why this is not `mark || 0`.
        if (mark === null || mark === undefined) {
          marksUnattempted += item.maxMark;
        } else {
          attemptedAnything = true;
          marksAwarded += mark;
        }
      }

      const attainedPercent = percentOrNull(marksAwarded, marksAllotted, `'${level}' attained by ${studentId}`);
      return {
        level,
        marksAllotted,
        marksAwarded,
        marksUnattempted,
        attainedPercent,
        // The band table is fed the marks directly rather than the
        // percentage, so the 80/60/40 boundaries are decided by exact
        // cross-multiplication and a student exactly on 80% lands on 3.
        attainmentLevel: marksAllotted > 0 ? lookupBand(marksAwarded, marksAllotted, bands).level : null,
      };
    });

    const marksAllotted = perLevel.reduce((sum, r) => sum + r.marksAllotted, 0);
    const marksAwarded = perLevel.reduce((sum, r) => sum + r.marksAwarded, 0);

    return {
      studentId,
      absent: !attemptedAnything,
      perLevel,
      marksAllotted,
      marksAwarded,
      overallPercent: attemptedAnything ? percentOrNull(marksAwarded, marksAllotted, `overall for ${studentId}`) : null,
    };
  });

  const absentStudentIds = students.filter((s) => s.absent).map((s) => s.studentId);
  if (absentStudentIds.length > 0) {
    warnings.push(
      makeWarning(
        'KL_STUDENT_ABSENT',
        'info',
        `${absentStudentIds.length} student(s) attempted no question in this paper. They are reported as absent, not as having attained nothing, and are excluded from the class figures.`,
        {},
      ),
    );
  }

  // A partly-attempted paper deflates that student's figures, because the
  // denominator is the paper. Stated once, with a count, rather than once
  // per student — a class of forty would otherwise bury every other
  // warning on the page.
  const partial = students.filter((s) => !s.absent && s.perLevel.some((r) => r.marksUnattempted > 0));
  if (partial.length > 0) {
    warnings.push(
      makeWarning(
        'KL_MARKS_UNATTEMPTED',
        'info',
        `${partial.length} student(s) left questions unattempted. Those marks stay in the denominator, as the college's method requires, so the figures below read lower than the marks they attempted alone would give.`,
        {},
      ),
    );
  }

  // ── the class ──
  const present = students.filter((s) => !s.absent);
  const cohort: CohortLevelRow[] = levels.map((level, index) => {
    const rows = present.map((s) => s.perLevel[index]!);
    const marksAllotted = rows.reduce((sum, r) => sum + r.marksAllotted, 0);
    const marksAwarded = rows.reduce((sum, r) => sum + r.marksAwarded, 0);

    // Counted over the class's marks, not as the mean of per-student
    // percentages: the two differ, and the marks ratio is the one that
    // does not let a student who sat two questions weigh as much as one
    // who sat the paper.
    const distribution: Record<Level, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (const r of rows) if (r.attainmentLevel !== null) distribution[r.attainmentLevel] += 1;

    return {
      level,
      studentsCounted: present.length,
      marksAllotted,
      marksAwarded,
      attainedPercent: percentOrNull(marksAwarded, marksAllotted, `class attainment of '${level}'`),
      attainmentLevel: marksAllotted > 0 ? lookupBand(marksAwarded, marksAllotted, bands).level : null,
      distribution,
    };
  });

  if (present.length === 0 && studentIds.length > 0) {
    warnings.push(
      makeWarning('KL_NO_STUDENTS_PRESENT', 'warning', 'No student attempted any question, so there are no class figures.', {}),
    );
  }

  return { blueprint, paperTotal, students, cohort, absentStudentIds, warnings };
}
