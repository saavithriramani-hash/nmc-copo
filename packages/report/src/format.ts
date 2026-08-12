/**
 * How a figure is written on a filed document.
 *
 * Shared rather than repeated per renderer, because the same attainment
 * must read identically whichever format an assessor opens. A PDF saying
 * 2.375 beside a Word file saying 2.38 is not a formatting inconsistency
 * — it is two documents disagreeing about a number that was approved and
 * locked once.
 *
 * An absent value is an em dash, never 0: "not measured" and "measured
 * as nothing" are different facts everywhere in this system.
 */
export const fmt = (value: number | null | undefined, dp = 3): string =>
  value === null || value === undefined ? '—' : value.toFixed(dp);

export const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
