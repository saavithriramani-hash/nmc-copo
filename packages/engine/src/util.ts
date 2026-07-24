import { EngineAssertionError } from './errors';
import type { EngineWarning, WarningCode, WarningRef } from './types';

/**
 * Mean over the given values, or null for an empty list. The engine never
 * turns "no values" into 0 (§9): absence propagates as null plus a warning
 * raised where the absence was detected.
 */
export function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Internal lookup that must succeed; failure means an engine bug. */
export function getOrThrow<T>(record: Record<string, T>, key: string, context: string): T {
  const value = record[key];
  if (value === undefined) {
    throw new EngineAssertionError(`${context}: missing key '${key}' — engine invariant violated`);
  }
  return value;
}

export function makeWarning(
  code: WarningCode,
  severity: EngineWarning['severity'],
  message: string,
  ref: WarningRef,
): EngineWarning {
  return { code, severity, message, ref };
}
