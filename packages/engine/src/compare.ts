/**
 * Boundary comparisons.
 *
 * The Procedure's thresholds are inclusive: a mark exactly on the threshold
 * is attained, a cohort exactly on a band bound lands on that band. IEEE 754
 * doubles cannot represent decimals like 0.7 exactly, so the naive
 * `mark >= fraction * maxMark` can fail on the boundary (the product's
 * rounding may land a hair above an exactly-on-threshold mark). The two
 * helpers below avoid that; use them for every boundary decision. Display
 * values (e.g. thresholdMark = fraction × max) may be computed naively but
 * must never be used to decide anything.
 */

/**
 * Exact test for `a / b >= f` where f denotes a decimal fraction.
 *
 * IEEE division is correctly rounded, so when the real ratio a/b equals the
 * real decimal that the literal f denotes (e.g. 3.5/5 and 0.7), both sides
 * round to the identical double and the comparison is exact. Marks are
 * entered in steps of at least 0.25, so ratios never fall within one ulp of
 * a bound without being equal to it.
 *
 * Requires b > 0 (validated upstream).
 */
export function ratioGte(a: number, b: number, f: number): boolean {
  return a / b >= f;
}

/**
 * Exact test for `count / total × 100 >= boundPercent`, by cross-
 * multiplication: `count × 100 >= boundPercent × total`. With integer
 * counts and integer band bounds both sides are exact integers, so band
 * boundary decisions (exactly 80%, 60%, 40% of students) carry no floating-
 * point error at all.
 *
 * Requires total > 0 (guarded upstream).
 */
export function countPctGte(count: number, total: number, boundPercent: number): boolean {
  return count * 100 >= boundPercent * total;
}
