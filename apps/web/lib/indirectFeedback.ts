import type { IndirectCounts } from '@copo/engine';

/**
 * CO-wise indirect feedback entry (Procedure Step 8, FR-3).
 *
 * The Procedure collects a 3-point rating per CO from students; the
 * college enters the TALLY — how many chose 1, 2 and 3 — not individual
 * responses. Step 8 then computes
 * `indirect(CO) = (1·n1 + 2·n2 + 3·n3) ÷ N`.
 *
 * NOTE on blank ≠ zero: that rule governs MARKS, where an empty cell
 * means a student did not attempt. It does not apply here. These are
 * counts, so an empty box genuinely means nobody chose that option — it
 * is zero. "No feedback for this CO" is all three being zero, which the
 * engine turns into a null value plus a warning rather than a zero
 * attainment. The distinction is preserved, one level up.
 */

export interface FeedbackDraft {
  coId: string;
  n1: string;
  n2: string;
  n3: string;
}

export type CountParse = { error: string } | { value: number };

/** Counts are whole and non-negative; empty means none chose that option. */
export function parseCount(raw: string): CountParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: 0 };
  if (!/^\d+$/.test(trimmed)) return { error: 'must be a whole number of responses' };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { error: 'is too large' };
  return { value };
}

export interface ParsedFeedback {
  coId: string;
  counts: IndirectCounts;
}
export type FeedbackParse = { errors: string[] } | { rows: ParsedFeedback[] };

export function parseFeedbackDraft(draft: readonly FeedbackDraft[], labelFor: (coId: string) => string): FeedbackParse {
  const errors: string[] = [];
  const rows: ParsedFeedback[] = [];

  for (const row of draft) {
    const parsed: Partial<IndirectCounts> = {};
    for (const field of ['n1', 'n2', 'n3'] as const) {
      const result = parseCount(row[field]);
      if ('error' in result) {
        errors.push(`${labelFor(row.coId)}, rating ${field.slice(1)}: ${result.error}.`);
      } else {
        parsed[field] = result.value;
      }
    }
    if (parsed.n1 !== undefined && parsed.n2 !== undefined && parsed.n3 !== undefined) {
      rows.push({ coId: row.coId, counts: { n1: parsed.n1, n2: parsed.n2, n3: parsed.n3 } });
    }
  }

  return errors.length > 0 ? { errors } : { rows };
}

export const responsesOf = (counts: IndirectCounts): number => counts.n1 + counts.n2 + counts.n3;

/** True when the row carries nothing — stored as no row at all. */
export const isEmpty = (counts: IndirectCounts): boolean => responsesOf(counts) === 0;

/** Formats Step 8's value for display; null stays visibly absent. */
export function formatIndirect(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

/** Draft rows for every CO, seeded from whatever is already stored. */
export function draftFromStored(
  coIds: readonly string[],
  stored: ReadonlyMap<string, IndirectCounts>,
): FeedbackDraft[] {
  return coIds.map((coId) => {
    const counts = stored.get(coId);
    return {
      coId,
      n1: counts ? String(counts.n1) : '',
      n2: counts ? String(counts.n2) : '',
      n3: counts ? String(counts.n3) : '',
    };
  });
}
