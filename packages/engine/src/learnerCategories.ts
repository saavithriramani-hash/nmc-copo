import { assertPercentInRange } from './assert';
import { ratioGte } from './compare';
import type { EngineWarning } from './types';
import { makeWarning } from './util';

/**
 * Slow and advanced learners — the college's NAAC 2.2.1 identification, as
 * filed in `docs/Copy of  Slow and Advanced LearnersB. Sc. Mathematics
 * (2023-2026).xlsx`.
 *
 * STANDALONE, AND DELIBERATELY SO — the same footing as knowledgeLevels.ts.
 * This is not one of the ten steps and feeds none of them. `computeCourse`
 * neither calls it nor is affected by it: CO and PO/PSO attainment are
 * exactly what the Procedure defines, before and after this file existed.
 * It answers a different question — not "was the outcome attained?" but
 * "which students need help, and which need stretching?"
 *
 * WHAT THE WORKBOOK DOES. Each subject is rated on several criteria, each
 * out of 20: four the teacher judges (interaction, flipped learning,
 * seminar, interest in self-learning) and one derived from the mark ledger
 * ("Weightage (20) CIA & Semester"). Each criterion is averaged across the
 * semester's subjects, the averages are summed to a score out of 100, and
 * the student is classified.
 *
 * FIVE FAULTS IN THE FILED WORKBOOK THAT THIS FUNCTION MAKES IMPOSSIBLE.
 * Each has a regression test named for it in `tests/learnerCategories.test.ts`.
 *
 * 1. `FinalSem1!I6` is `=SUM(D10+E10+F10+G10+H10)`, shared down to I18:
 *    thirteen of seventeen students display the score of the student four
 *    rows below. The two highest scorers in the semester are on file as
 *    slow learners. Here a student's score is reachable only through their
 *    own id, so a row offset has nothing to offset.
 * 2. No rule behind the label — it is typed by hand, and 84.6 appears as
 *    both "SL" and "AL" in the same sheet. Here the category comes from a
 *    band table and nothing else.
 * 3. Formulas overtyped with literals (FinalSem2 rows 6-7 hold one
 *    subject's raw figures where the three-subject mean belongs). Nothing
 *    derived is stored, so there is nothing to overtype.
 * 4. One cell rounded and no other (`ROUND(...,0)` in FinalSem2!D22).
 *    Rounding happens at display, never inside the arithmetic.
 * 5. Hard-coded divisors (`/2`, `/3`) that count a subject the student
 *    never took. Here the divisor is the number of ratings that exist.
 *
 * BLANK IS NOT ZERO, and this is where it bites hardest: a criterion the
 * teacher has not yet rated must not drag a student towards "slow". An
 * unrated criterion leaves both the numerator and the denominator, and the
 * fact is reported rather than absorbed.
 */

/** One thing a student is rated on, in one subject. */
export interface LearnerCriterion {
  id: string;
  label: string;
  /** Maximum obtainable score. Must be > 0. */
  maxScore: number;
  /**
   * True when the score is derived from the mark ledger rather than
   * entered by a teacher ("Weightage (20) CIA & Semester"). The engine
   * treats it identically — the flag exists so a report can say which
   * figures were judged and which were counted, since a classification
   * that is four parts opinion to one part measurement should say so.
   */
  derived: boolean;
}

/** One subject a student took, with what they were rated on it. */
export interface LearnerCourseRatings {
  courseId: string;
  courseTitle: string;
  /** Students enrolled in this subject. */
  studentIds: string[];
  /**
   * studentId → criterionId → score. `null`, or an absent key, means not
   * rated — never zero.
   */
  scores: Record<string, Record<string, number | null>>;
}

/** A category and the score at which it starts. */
export interface CategoryBandRow {
  /** Inclusive lower bound, as a percentage of the obtainable total. */
  lowerPercent: number;
  /** "Advanced" · "Average" · "Slow". Free text: the college's wording. */
  category: string;
}

export interface LearnerCategoryInput {
  criteria: LearnerCriterion[];
  courses: LearnerCourseRatings[];
  /**
   * Every student of the batch, including any enrolled in nothing this
   * semester. Passed explicitly so "took no subject" is representable
   * rather than looking like a student who does not exist.
   */
  studentIds: string[];
  /**
   * Must include a row at `lowerPercent: 0`, so every score lands
   * somewhere and no student falls off the bottom of the table unlabelled.
   */
  bands: CategoryBandRow[];
}

/** One student's standing on one criterion, across the semester. */
export interface CriterionMeanRow {
  criterionId: string;
  /**
   * The mean of the subjects in which this criterion was rated — not of
   * the subjects taken. Fault 5.
   */
  mean: number | null;
  /** Subjects contributing to the mean, i.e. the divisor actually used. */
  ratedIn: number;
  /** Subjects taken but not rated on this criterion. */
  unratedIn: number;
  maxScore: number;
}

export interface StudentCategoryRow {
  studentId: string;
  /** Subjects the student is enrolled in this semester. */
  coursesTaken: number;
  perCriterion: CriterionMeanRow[];
  /**
   * How many of the criteria a PERSON judges this student has a mean for
   * — the derived weightage does not count towards it.
   *
   * Zero means nobody has judged them, and they are left unclassified
   * even when the derived figure alone would place them somewhere. The
   * whole point of the exercise is that a learner's standing is more than
   * their marks; classifying on the derived criterion by itself would be
   * a mark percentage wearing the word "Average", and would quietly label
   * every unjudged student in the college.
   */
  judgedCriteria: number;
  /**
   * Sum of the criterion means that exist. `null` when none does.
   * This is the workbook's "Final Score" — reported raw because that is
   * the number the department reads.
   */
  totalScore: number | null;
  /**
   * Obtainable total, counting ONLY the criteria this student has a mean
   * for. A student rated on four of five criteria is scored out of 80,
   * not out of 100 — otherwise the missing rating would read as a failing
   * one, which is the blank-is-not-zero invariant at semester scale.
   */
  obtainableScore: number;
  /** `totalScore` as a percentage of `obtainableScore`; null when unrated. */
  finalPercent: number | null;
  /** `null` when there is nothing to classify. Never a default category. */
  category: string | null;
  /** True when the figure rests on fewer criteria than the cohort's full set. */
  partiallyRated: boolean;
}

/** How many students landed in one category. */
export interface CategoryCountRow {
  category: string;
  students: number;
  /** Share of the classified students, as a percentage. */
  percent: number | null;
}

export interface LearnerCategoryResult {
  students: StudentCategoryRow[];
  counts: CategoryCountRow[];
  /** Students with no rating anywhere; excluded from `counts`. */
  unclassifiedStudentIds: string[];
  /** Sum of every criterion's maximum — the workbook's 100. */
  fullObtainableScore: number;
  warnings: EngineWarning[];
}

/**
 * The default classification, pending the department's confirmation.
 *
 * The filed workbook has no rule at all — the label is typed by hand, and
 * the same score of 84.6 appears as both "SL" and "AL" in one sheet — so
 * there was nothing to copy. Three categories rather than the workbook's
 * two, because a scheme with no middle put 76% of the 2023-2026 Semester 1
 * cohort in "slow", which tells a reader nothing.
 *
 * Overridable institution → programme like every other band table (§4),
 * and the applied values are printed on the report.
 */
export const DEFAULT_CATEGORY_BANDS: readonly CategoryBandRow[] = [
  { lowerPercent: 75, category: 'Advanced' },
  { lowerPercent: 60, category: 'Average' },
  { lowerPercent: 0, category: 'Slow' },
];

/**
 * The five criteria the Mathematics department uses, offered as a starting
 * point when a programme has none. Not built in: a programme's criteria
 * are its own, and thirty programmes will not agree on these.
 *
 * The last is `derived` — the workbook's "Weightage (20) CIA & Semester",
 * which is the student's mark percentage scaled to the criterion maximum
 * and so is counted, not judged.
 */
export const DEFAULT_LEARNER_CRITERIA: readonly Omit<LearnerCriterion, 'id'>[] = [
  { label: 'Interaction with teachers', maxScore: 20, derived: false },
  { label: 'Flipped learning', maxScore: 20, derived: false },
  { label: 'Seminar', maxScore: 20, derived: false },
  { label: 'Interest shown towards self-learning', maxScore: 20, derived: false },
  { label: 'Weightage — CIA & semester', maxScore: 20, derived: true },
];

/**
 * The category whose lower bound the score reaches, highest first.
 *
 * Compared as a ratio rather than against a pre-divided percentage, so a
 * student exactly on a bound lands on the higher category — the same
 * inclusive-boundary rule the attainment bands follow (§4.2).
 */
function lookupCategory(total: number, obtainable: number, bands: CategoryBandRow[]): string | null {
  if (!(obtainable > 0)) return null;
  const sorted = [...bands].sort((a, b) => b.lowerPercent - a.lowerPercent);
  for (const band of sorted) {
    if (ratioGte(total, obtainable, band.lowerPercent / 100)) return band.category;
  }
  return null;
}

export function computeLearnerCategories(input: LearnerCategoryInput): LearnerCategoryResult {
  const { criteria, courses, studentIds, bands } = input;
  const warnings: EngineWarning[] = [];

  for (const criterion of criteria) {
    if (!(criterion.maxScore > 0)) {
      throw new Error(`criterion ${criterion.id} has a non-positive maximum (${criterion.maxScore})`);
    }
  }
  if (!bands.some((b) => b.lowerPercent <= 0)) {
    throw new Error('the category band table has no row at 0, so a low score would be unclassifiable');
  }

  const fullObtainableScore = criteria.reduce((sum, c) => sum + c.maxScore, 0);
  /** Does anything here rest on a person's judgement rather than the marks? */
  const anyJudged = criteria.some((c) => !c.derived);

  if (criteria.length === 0) {
    warnings.push(
      makeWarning('LC_NO_CRITERIA', 'warning', 'No rating criteria are configured, so no learner can be classified.', {}),
    );
  }

  // A subject nobody has been rated on contributes nothing to anybody's
  // mean, which silently shrinks every divisor. Named, because the cause
  // is a teacher who has not filled the sheet in, not a property of the
  // cohort.
  for (const course of courses) {
    const anyRating = course.studentIds.some((sid) =>
      criteria.some((c) => {
        const v = course.scores[sid]?.[c.id];
        return v !== null && v !== undefined;
      }),
    );
    if (!anyRating && course.studentIds.length > 0) {
      warnings.push(
        makeWarning(
          'LC_COURSE_UNRATED',
          'warning',
          `No student has been rated in '${course.courseTitle}', so it contributes to no figure below.`,
          { courseId: course.courseId },
        ),
      );
    }
  }

  const students: StudentCategoryRow[] = studentIds.map((studentId) => {
    const taken = courses.filter((c) => c.studentIds.includes(studentId));

    const perCriterion: CriterionMeanRow[] = criteria.map((criterion) => {
      let sum = 0;
      let ratedIn = 0;
      let unratedIn = 0;

      for (const course of taken) {
        const score = course.scores[studentId]?.[criterion.id];
        // Blank and absent-key are the same fact; zero is a real rating
        // and is neither. This is why it is not `score ?? 0`.
        if (score === null || score === undefined) {
          unratedIn += 1;
        } else {
          if (score < 0 || score > criterion.maxScore) {
            throw new Error(
              `rating ${score} for '${criterion.label}' is outside 0..${criterion.maxScore} (student ${studentId}, course ${course.courseId})`,
            );
          }
          sum += score;
          ratedIn += 1;
        }
      }

      return {
        criterionId: criterion.id,
        // The divisor is what was rated, never the subjects taken.
        mean: ratedIn > 0 ? sum / ratedIn : null,
        ratedIn,
        unratedIn,
        maxScore: criterion.maxScore,
      };
    });

    const contributing = perCriterion.filter((r) => r.mean !== null);
    const obtainableScore = contributing.reduce((s, r) => s + r.maxScore, 0);
    const totalScore = contributing.length > 0 ? contributing.reduce((s, r) => s + r.mean!, 0) : null;

    const finalPercent =
      totalScore !== null && obtainableScore > 0 ? (totalScore / obtainableScore) * 100 : null;
    if (finalPercent !== null) assertPercentInRange(finalPercent, `final score for ${studentId}`);

    const judgedCriteria = perCriterion.filter(
      (r, i) => r.mean !== null && criteria[i]!.derived === false,
    ).length;
    // A programme that configures nothing but derived criteria has asked
    // for a purely computed classification, and gets one. Every other
    // programme needs a person to have judged the student first.
    const classifiable = totalScore !== null && (!anyJudged || judgedCriteria > 0);

    return {
      studentId,
      coursesTaken: taken.length,
      perCriterion,
      judgedCriteria,
      totalScore,
      obtainableScore,
      finalPercent,
      category: classifiable ? lookupCategory(totalScore!, obtainableScore, bands) : null,
      partiallyRated: contributing.length > 0 && contributing.length < criteria.length,
    };
  });

  const unclassifiedStudentIds = students.filter((s) => s.category === null).map((s) => s.studentId);

  // Two different absences, and conflating them would hide the one the
  // department can act on: nothing recorded at all, versus a student whose
  // marks are in but whom no teacher has yet judged.
  const nothing = students.filter((s) => s.totalScore === null && s.coursesTaken > 0);
  if (nothing.length > 0) {
    warnings.push(
      makeWarning(
        'LC_STUDENT_UNRATED',
        'warning',
        `${nothing.length} student(s) have nothing recorded in any subject and are left unclassified rather than counted as slow learners.`,
        {},
      ),
    );
  }

  const unjudged = students.filter((s) => s.totalScore !== null && s.category === null);
  if (unjudged.length > 0) {
    warnings.push(
      makeWarning(
        'LC_NOT_JUDGED',
        'warning',
        `${unjudged.length} student(s) have a mark-derived figure but no teacher's judgement in any subject, so they are left unclassified. A classification resting on the marks alone would be a mark percentage wearing a category name.`,
        {},
      ),
    );
  }

  const partial = students.filter((s) => s.partiallyRated);
  if (partial.length > 0) {
    warnings.push(
      makeWarning(
        'LC_PARTIALLY_RATED',
        'info',
        `${partial.length} student(s) are rated on some criteria but not all. Their score is out of the criteria that were rated, not out of ${fullObtainableScore}, so it is not directly comparable with a fully rated student's.`,
        {},
      ),
    );
  }

  const notEnrolled = students.filter((s) => s.coursesTaken === 0);
  if (notEnrolled.length > 0) {
    warnings.push(
      makeWarning(
        'LC_NOT_ENROLLED',
        'info',
        `${notEnrolled.length} student(s) of this batch are enrolled in no subject this semester.`,
        {},
      ),
    );
  }

  // Counted over the classified students only. A cohort where half are
  // unrated must not report "50% slow learners".
  const classified = students.filter((s) => s.category !== null);
  const order = [...bands].sort((a, b) => b.lowerPercent - a.lowerPercent).map((b) => b.category);
  const counts: CategoryCountRow[] = order.map((category) => {
    const n = classified.filter((s) => s.category === category).length;
    const percent = classified.length > 0 ? (n / classified.length) * 100 : null;
    if (percent !== null) assertPercentInRange(percent, `share in category '${category}'`);
    return { category, students: n, percent };
  });

  return { students, counts, unclassifiedStudentIds, fullObtainableScore, warnings };
}
