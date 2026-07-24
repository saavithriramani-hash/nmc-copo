import type { AssessmentCoResult, CourseInput, CourseResult, EngineWarning, ItemScore } from './types';
import { assertValidCourseInput } from './validate';
import { step1ArticulationWeightages } from './steps/step1Weightage';
import { step4AssessmentCoLevels } from './steps/step4AssessmentCo';
import { step5GroupCoLevels } from './steps/step5GroupCo';
import { step8IndirectAttainment } from './steps/step8Indirect';
import { step9FinalCoAttainment } from './steps/step9FinalCo';
import { step10PoAttainment } from './steps/step10Po';

/**
 * Runs the full ten-step chain for one course: marks and parameters in,
 * the complete attainment chain out. Pure and deterministic — no I/O, no
 * clock, no randomness; identical input always yields identical output.
 *
 * Throws EngineValidationError for inputs that are not computable (§ see
 * validate.ts). Gaps that are legal but degenerate (§5.1) come back as
 * structured warnings alongside defined results — never a crash, never a
 * silent zero. Warnings are ordered by procedure step, then input order,
 * so reports are reproducible byte-for-byte.
 *
 * The result stores no derived value anywhere else: callers persist marks
 * and parameters, and recompute on demand (the only exception, an
 * immutable snapshot of a locked course, lives outside the engine).
 */
export function computeCourse(input: CourseInput): CourseResult {
  assertValidCourseInput(input);

  const courseCoIds = input.cos.map((co) => co.id);
  const { parameters } = input;
  const warnings: EngineWarning[] = [];

  // Step 1 — articulation weightages.
  const step1 = step1ArticulationWeightages(input.cos, input.poMatrix);
  warnings.push(...step1.warnings);

  // Steps 3 & 4 — per assessment: item scores and CO levels.
  const itemScores: ItemScore[] = [];
  const assessmentCo: AssessmentCoResult[] = [];
  for (const assessment of input.assessments) {
    const step4 = step4AssessmentCoLevels(assessment, courseCoIds, parameters);
    itemScores.push(...step4.itemScores);
    assessmentCo.push(...step4.results);
    warnings.push(...step4.warnings);
  }

  // Step 5 (and 6, 7) — consolidate within each weight group.
  const step5 = step5GroupCoLevels(parameters.weightGroups, input.assessments, assessmentCo, courseCoIds);
  warnings.push(...step5.warnings);

  // Step 8 — indirect attainment.
  const step8 = step8IndirectAttainment(courseCoIds, input.indirect, parameters.feedbackResponseFloor);
  warnings.push(...step8.warnings);

  // Step 9 — final CO attainment.
  const groupsWithAssessments = [...new Set(input.assessments.map((a) => a.weightGroup))];
  const step9 = step9FinalCoAttainment(courseCoIds, parameters, groupsWithAssessments, step5.results, step8.results);
  warnings.push(...step9.warnings);

  // Step 10 — PO/PSO projection.
  const step10 = step10PoAttainment(step1.result, step9.results);
  warnings.push(...step10.warnings);

  return {
    parameters,
    step1: step1.result,
    itemScores,
    assessmentCo,
    groupCo: step5.results,
    indirect: step8.results,
    finalCo: step9.results,
    po: step10.results,
    warnings,
  };
}
