/**
 * Course-level rubric threshold override (§4.1, FR-3).
 *
 * The threshold decides whether a mark counts as *attained*: a student
 * clears an item when `mark ≥ thresholdFraction × item maximum`. It is
 * uniform across assessment types, and applies only to RUBRIC scoring —
 * the end-semester COHORT_BAND rule carries its own per-band score
 * cut-offs and ignores this entirely.
 *
 * `null` at course level means "inherit" (programme, then institution);
 * that is the normal state. A course-level value records an
 * Academic-Council-minuted exception, which is why it belongs to the HoD
 * and appears on the course report.
 *
 * Pure so the parsing and boundary rules are testable without a database.
 */

/** The engine's own bound: validateParameters requires (0, 1]. */
export const MIN_THRESHOLD_PERCENT = 0;
export const MAX_THRESHOLD_PERCENT = 100;

export type ParseResult = { error: string } | { value: number | null };

/**
 * Reads what the HoD typed, as a PERCENTAGE — staff talk in "70%", not
 * "0.7", and the engine's fraction is an implementation detail.
 * An empty string means "clear the override and inherit again".
 */
export function parseThresholdPercent(raw: string): ParseResult {
  const trimmed = raw.trim().replace(/%$/, '').trim();
  if (trimmed === '') return { value: null };

  const percent = Number(trimmed);
  if (!Number.isFinite(percent)) return { error: 'Enter a percentage, for example 70.' };
  // Exclusive at 0: a threshold of zero would mark every attempt as
  // cleared, including a blank-but-zero score, which is meaningless.
  if (percent <= MIN_THRESHOLD_PERCENT) return { error: 'The threshold must be greater than 0%.' };
  if (percent > MAX_THRESHOLD_PERCENT) return { error: 'The threshold cannot exceed 100%.' };

  // Guard the round trip: the column is Decimal(4,3), so a fraction may
  // carry three decimals — 70.05% would silently truncate to 0.7005 → 0.700.
  const fraction = percent / 100;
  if (Number(fraction.toFixed(3)) !== fraction) {
    return { error: 'Use at most one decimal place, for example 66.7%.' };
  }
  return { value: fraction };
}

/** Fraction → the percentage shown in the field. 0.7 → "70". */
export function formatThresholdPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '';
  return String(Number((fraction * 100).toFixed(1)));
}

/**
 * The worked example the screen shows, so the HoD sees the consequence
 * before saving rather than inferring it: what mark clears a typical item.
 */
export function thresholdExample(fraction: number, maxMark: number): string {
  const needed = fraction * maxMark;
  const rounded = Number(needed.toFixed(2));
  return `on a ${maxMark}-mark question a student needs ${rounded} to be counted as attained`;
}

/** Human label for where the effective value came from (Step 2 provenance). */
export function describeSource(source: 'institution' | 'programme' | 'course'): string {
  switch (source) {
    case 'course':
      return 'this course (an override)';
    case 'programme':
      return 'the programme';
    case 'institution':
      return 'the institution default';
  }
}
