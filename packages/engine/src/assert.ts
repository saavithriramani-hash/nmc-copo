import { EngineAssertionError } from './errors';

/**
 * Invariant (§9, CLAUDE.md): every percentage lies in [0, 100]. A violation
 * indicates an inverted or corrupted ratio and is a thrown error, never a
 * warning. NaN fails both comparisons and therefore also throws.
 */
export function assertPercentInRange(value: number, context: string): void {
  if (!(value >= 0 && value <= 100)) {
    throw new EngineAssertionError(
      `${context}: percentage ${value} lies outside [0, 100] — ` +
        'this indicates an inverted or corrupted ratio (requirements §9)',
    );
  }
}
