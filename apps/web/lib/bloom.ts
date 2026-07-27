/**
 * Bloom's taxonomy levels for CO definitions (FR-5). Display strings; the
 * engine does not interpret them and no attainment number depends on
 * them.
 *
 * A CO carries **one or more** levels: a single outcome commonly spans
 * two adjacent levels ("explain and apply"), and forcing one loses that.
 * Note FR-5 says "Bloom's level" in the singular — this is a deliberate
 * change against that baseline, not an implementation of it.
 */
export const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'] as const;

export type BloomLevel = (typeof BLOOM_LEVELS)[number];

export function isBloomLevel(value: string): value is BloomLevel {
  return (BLOOM_LEVELS as readonly string[]).includes(value);
}

/**
 * Canonical form for storage and display: duplicates dropped, ordered by
 * the taxonomy itself (Remember → Create) rather than by the order the
 * boxes happened to be ticked. Two COs with the same levels then read
 * identically and produce no spurious audit-log differences.
 */
export function normaliseBloomLevels(levels: readonly string[]): BloomLevel[] {
  const chosen = new Set(levels.filter(isBloomLevel));
  return BLOOM_LEVELS.filter((level) => chosen.has(level));
}

/** Null when acceptable; otherwise the reason, for display. */
export function validateBloomLevels(levels: readonly string[]): string | null {
  const unknown = levels.find((level) => !isBloomLevel(level));
  if (unknown !== undefined) return `Unknown Bloom level '${unknown}'.`;
  if (normaliseBloomLevels(levels).length === 0) return 'Every CO needs at least one Bloom level.';
  return null;
}

/**
 * For report tables and read-only rows. Tolerates a missing list so that
 * an immutable snapshot written before COs carried multiple levels
 * renders blank instead of throwing — snapshots cannot be migrated, a
 * database trigger forbids updating them.
 */
export function formatBloomLevels(levels: readonly string[] | null | undefined): string {
  return (levels ?? []).join(', ');
}
