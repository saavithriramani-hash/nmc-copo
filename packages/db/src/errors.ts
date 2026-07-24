/**
 * Thrown when database rows cannot be mapped to the engine's input shape —
 * e.g. a SINGLE_SCORE assessment whose item count is not exactly one.
 * This always indicates corrupt or half-written setup data, never bad
 * marks; the engine's own validation still runs after the adapter.
 */
export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}
