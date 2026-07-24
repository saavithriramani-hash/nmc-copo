import { EngineValidationError } from '../errors';
import type { ParameterSource, Parameters, Step2Result } from '../types';
import { validateParameters } from '../validate';

/** A partial override layer: only the fields a level actually overrides. */
export type ParameterOverrides = Partial<Parameters>;

/**
 * Procedure Step 2 — parameter resolution, institution → programme → course.
 *
 * Field-wise: the most specific level that supplies a field wins. Tables
 * (bands, cohortBands, weightGroups) are replaced whole by an overriding
 * level, never merged row-by-row — a partial table merge has no defined
 * meaning. Provenance records which level supplied each field, because
 * every applied override must appear on the course report (§4).
 *
 * The resolved set is validated; an inconsistent result (weights not
 * summing to 1, an empty band table) throws EngineValidationError.
 */
export function step2ResolveParameters(
  institution: Parameters,
  programme?: ParameterOverrides,
  course?: ParameterOverrides,
): Step2Result {
  function pick<K extends keyof Parameters>(key: K): { value: Parameters[K]; source: ParameterSource } {
    const fromCourse = course?.[key];
    if (fromCourse !== undefined) return { value: fromCourse as Parameters[K], source: 'course' };
    const fromProgramme = programme?.[key];
    if (fromProgramme !== undefined) return { value: fromProgramme as Parameters[K], source: 'programme' };
    return { value: institution[key], source: 'institution' };
  }

  const thresholdFraction = pick('thresholdFraction');
  const bands = pick('bands');
  const cohortBands = pick('cohortBands');
  const weightGroups = pick('weightGroups');
  const directWeight = pick('directWeight');
  const indirectWeight = pick('indirectWeight');
  const targetAttainment = pick('targetAttainment');
  const feedbackResponseFloor = pick('feedbackResponseFloor');

  const parameters: Parameters = {
    thresholdFraction: thresholdFraction.value,
    bands: bands.value,
    cohortBands: cohortBands.value,
    weightGroups: weightGroups.value,
    directWeight: directWeight.value,
    indirectWeight: indirectWeight.value,
    targetAttainment: targetAttainment.value,
    feedbackResponseFloor: feedbackResponseFloor.value,
  };

  const issues = validateParameters(parameters, 'resolvedParameters');
  if (issues.length > 0) throw new EngineValidationError(issues);

  return {
    procedureStep: 2,
    parameters,
    provenance: {
      thresholdFraction: thresholdFraction.source,
      bands: bands.source,
      cohortBands: cohortBands.source,
      weightGroups: weightGroups.source,
      directWeight: directWeight.source,
      indirectWeight: indirectWeight.source,
      targetAttainment: targetAttainment.source,
      feedbackResponseFloor: feedbackResponseFloor.source,
    },
  };
}
