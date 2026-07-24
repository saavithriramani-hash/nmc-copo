/**
 * @copo/engine — CO-PO attainment calculation engine.
 *
 * Pure TypeScript, zero runtime dependencies: no database access, no
 * framework imports, no I/O. Marks and parameters in, the full attainment
 * chain out. Liftable out of this repository and verifiable on its own.
 *
 * Implements the ten steps of `docs/CO-PO_Attainment_StepByStep_Procedure`
 * as confirmed by `docs/COPO_App_Requirements_v1.0.md` §5.
 */

/**
 * Engine version, recorded in every AttainmentSnapshot so an auditor can
 * replay a locked course against the exact engine that produced it.
 * Keep in step with package.json.
 */
export const ENGINE_VERSION = '0.1.0';

export * from './types';
export { EngineValidationError, EngineAssertionError, type ValidationIssue } from './errors';
export { assertPercentInRange } from './assert';
export { ratioGte, countPctGte } from './compare';
export { DEFAULT_PARAMETERS } from './defaults';
export { validateCourseInput, assertValidCourseInput, validateParameters } from './validate';

export { step1ArticulationWeightages } from './steps/step1Weightage';
export { step2ResolveParameters, type ParameterOverrides } from './steps/step2Parameters';
export { step3ScoreItems, lookupBand } from './steps/step3ItemScores';
export { step4AssessmentCoLevels, scoreCohortBand } from './steps/step4AssessmentCo';
// Steps 6 and 7 are step5GroupCoLevels applied to the continuous and
// external groups — see §5 of the requirements.
export { step5GroupCoLevels } from './steps/step5GroupCo';
export { step8IndirectAttainment } from './steps/step8Indirect';
export { step9FinalCoAttainment } from './steps/step9FinalCo';
export { step10PoAttainment } from './steps/step10Po';

export { computeCourse } from './computeCourse';
