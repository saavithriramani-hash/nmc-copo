import { DEFAULT_PARAMETERS } from '../../src/index';
import type { CO, MarkRecord, Parameters } from '../../src/index';

/** n copies of a value — for building large synthetic cohorts. */
export function repeat<T>(value: T, times: number): T[] {
  return Array.from({ length: times }, () => value);
}

/**
 * Marks for one item, students S1..Sn in order. `null` = did not attempt.
 * Only the INPUT is generated; expected values in tests are always worked
 * out by hand from the counts used to build it (NFR-7).
 */
export function columnMarks(itemId: string, values: (number | null)[], prefix = 'S'): MarkRecord {
  const record: MarkRecord = {};
  values.forEach((v, i) => {
    record[`${prefix}${i + 1}`] = { [itemId]: v };
  });
  return record;
}

/** Merges per-item mark columns into one record (same student universe). */
export function mergeMarks(...records: MarkRecord[]): MarkRecord {
  const out: MarkRecord = {};
  for (const r of records) {
    for (const [enrolmentId, row] of Object.entries(r)) {
      out[enrolmentId] = { ...(out[enrolmentId] ?? {}), ...row };
    }
  }
  return out;
}

/** Confirmed institution defaults with test-specific overrides. */
export function makeParams(overrides: Partial<Parameters> = {}): Parameters {
  return { ...DEFAULT_PARAMETERS, ...overrides };
}

export function makeCo(id: string): CO {
  return { id, statement: `Statement for ${id}`, bloomLevel: 'Apply' };
}
