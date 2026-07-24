/**
 * Consolidation aggregation (FR-20/FR-21), pure and testable.
 *
 * The Procedure defines attainment for ONE course; it prescribes no
 * formula for combining courses. The consolidation therefore presents
 * every course's official PO figures verbatim, plus a clearly-labelled
 * arithmetic mean per PO across the courses that produced a value —
 * nothing is hidden inside the aggregate, and a course whose PO could
 * not be computed (null) is excluded from the mean, never counted as 0.
 */

export interface CoursePoRow {
  courseId: string;
  code: string;
  title: string;
  semester: number;
  /** PO code → official attainment (null = not computable). */
  po: Record<string, number | null>;
  warningCount: number;
  error?: string;
}

export interface PoMeanCell {
  mean: number | null;
  /** Courses that contributed a value. */
  n: number;
}

export function meanAcrossCourses(rows: CoursePoRow[], poCodes: string[]): Record<string, PoMeanCell> {
  const out: Record<string, PoMeanCell> = {};
  for (const code of poCodes) {
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const value = row.po[code];
      if (value !== null && value !== undefined) {
        sum += value;
        n += 1;
      }
    }
    out[code] = { mean: n === 0 ? null : sum / n, n };
  }
  return out;
}
