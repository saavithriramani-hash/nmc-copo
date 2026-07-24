/** Structured validation issue. `path` locates the offending input. */
export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

/**
 * Thrown by validateCourseInput / computeCourse when the input is not a
 * well-formed course. Impossible inputs (a mark above its maximum, weights
 * not summing to 1) are errors, not warnings: the engine refuses to produce
 * a number from them. Missing-but-legal inputs produce warnings instead.
 */
export class EngineValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      `Course input failed validation with ${issues.length} issue(s):\n` +
        issues.map((i) => `  [${i.code}] ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'EngineValidationError';
    this.issues = issues;
  }
}

/**
 * Thrown when an internal invariant is violated — e.g. a percentage outside
 * [0, 100] (§9: an inverted ratio must be an error, not a warning). If this
 * ever fires the engine has a bug; the number must not be trusted.
 */
export class EngineAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineAssertionError';
  }
}
