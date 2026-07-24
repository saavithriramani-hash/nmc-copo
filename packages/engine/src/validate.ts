import { EngineValidationError, type ValidationIssue } from './errors';
import type { Assessment, CourseInput, Item, Parameters } from './types';

/**
 * Input validation. Impossible inputs are hard errors (thrown), not
 * warnings: a mark above its maximum or weights that do not sum to 1 must
 * never reach the arithmetic. Missing-but-legal inputs (an item nobody
 * attempted, a CO with no feedback) are NOT validation errors — they flow
 * through the steps and produce structured warnings there (§5.1).
 */

const WEIGHT_SUM_TOLERANCE = 1e-9;

function isLevel(v: unknown): boolean {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates a fully resolved parameter set. Used by Step 2 and course validation. */
export function validateParameters(p: Parameters, path = 'parameters'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (code: string, subPath: string, message: string) =>
    issues.push({ code, path: `${path}.${subPath}`, message });

  if (!isFiniteNumber(p.thresholdFraction) || p.thresholdFraction <= 0 || p.thresholdFraction > 1) {
    issue('BAD_THRESHOLD', 'thresholdFraction', `must lie in (0, 1], got ${p.thresholdFraction}`);
  }

  if (!Array.isArray(p.bands) || p.bands.length === 0) {
    issue('BAD_BANDS', 'bands', 'band table must not be empty');
  } else {
    const bounds = new Set<number>();
    let hasZero = false;
    p.bands.forEach((b, i) => {
      if (!isFiniteNumber(b.lowerBound) || b.lowerBound < 0 || b.lowerBound > 100) {
        issue('BAD_BANDS', `bands[${i}].lowerBound`, `must lie in [0, 100], got ${b.lowerBound}`);
      } else if (bounds.has(b.lowerBound)) {
        issue('BAD_BANDS', `bands[${i}].lowerBound`, `duplicate lower bound ${b.lowerBound}`);
      } else {
        bounds.add(b.lowerBound);
        if (b.lowerBound === 0) hasZero = true;
      }
      if (!isLevel(b.level)) {
        issue('BAD_BANDS', `bands[${i}].level`, `level must be the integer 0, 1, 2 or 3, got ${JSON.stringify(b.level)}`);
      }
    });
    if (!hasZero) {
      issue('BAD_BANDS', 'bands', 'band table must contain a lowerBound-0 row so every percentage maps to a level');
    }
  }

  if (!Array.isArray(p.cohortBands)) {
    issue('BAD_COHORT_BANDS', 'cohortBands', 'must be an array');
  } else {
    const levels = new Set<number>();
    p.cohortBands.forEach((b, i) => {
      if (!isFiniteNumber(b.scorePercent) || b.scorePercent < 0 || b.scorePercent > 100) {
        issue('BAD_COHORT_BANDS', `cohortBands[${i}].scorePercent`, `must lie in [0, 100], got ${b.scorePercent}`);
      }
      if (!isFiniteNumber(b.cohortPercent) || b.cohortPercent < 0 || b.cohortPercent > 100) {
        issue('BAD_COHORT_BANDS', `cohortBands[${i}].cohortPercent`, `must lie in [0, 100], got ${b.cohortPercent}`);
      }
      if (!isLevel(b.level)) {
        issue('BAD_COHORT_BANDS', `cohortBands[${i}].level`, `level must be the integer 0, 1, 2 or 3, got ${JSON.stringify(b.level)}`);
      } else if (levels.has(b.level)) {
        issue('BAD_COHORT_BANDS', `cohortBands[${i}].level`, `duplicate level ${b.level}; each level may appear once`);
      } else {
        levels.add(b.level);
      }
    });
  }

  const groupIds = Object.keys(p.weightGroups);
  if (groupIds.length === 0) {
    issue('BAD_WEIGHTS', 'weightGroups', 'at least one weight group is required');
  } else {
    let sum = 0;
    for (const g of groupIds) {
      const w = p.weightGroups[g];
      if (!isFiniteNumber(w) || w <= 0 || w > 1) {
        issue('BAD_WEIGHTS', `weightGroups.${g}`, `weight must lie in (0, 1], got ${w}`);
      } else {
        sum += w;
      }
    }
    if (Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
      issue('BAD_WEIGHTS', 'weightGroups', `group weights must sum to 1.00, got ${sum}`);
    }
  }

  if (!isFiniteNumber(p.directWeight) || p.directWeight < 0 || !isFiniteNumber(p.indirectWeight) || p.indirectWeight < 0) {
    issue('BAD_WEIGHTS', 'directWeight', 'directWeight and indirectWeight must be non-negative numbers');
  } else if (Math.abs(p.directWeight + p.indirectWeight - 1) > WEIGHT_SUM_TOLERANCE) {
    issue('BAD_WEIGHTS', 'directWeight', `directWeight + indirectWeight must sum to 1.00, got ${p.directWeight + p.indirectWeight}`);
  }

  if (!isFiniteNumber(p.targetAttainment) || p.targetAttainment < 0 || p.targetAttainment > 3) {
    issue('BAD_TARGET', 'targetAttainment', `must lie in [0, 3], got ${p.targetAttainment}`);
  }

  if (!Number.isInteger(p.feedbackResponseFloor) || p.feedbackResponseFloor < 0) {
    issue('BAD_FLOOR', 'feedbackResponseFloor', `must be a non-negative integer, got ${p.feedbackResponseFloor}`);
  }

  return issues;
}

function validateItem(
  item: Item,
  coIdSet: Set<string>,
  seenItemIds: Set<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (seenItemIds.has(item.id)) {
    issues.push({ code: 'DUPLICATE_ID', path, message: `duplicate item id '${item.id}' within the assessment` });
  }
  seenItemIds.add(item.id);
  if (!isFiniteNumber(item.maxMark) || item.maxMark <= 0) {
    issues.push({ code: 'BAD_ITEM', path: `${path}.maxMark`, message: `maximum mark must be > 0, got ${item.maxMark}` });
  }
  if (item.coTag !== null && !coIdSet.has(item.coTag)) {
    issues.push({ code: 'UNKNOWN_CO_TAG', path: `${path}.coTag`, message: `'${item.coTag}' is not a CO of this course` });
  }
}

function validateAssessment(
  a: Assessment,
  coIdSet: Set<string>,
  parameters: Parameters,
  path: string,
  issues: ValidationIssue[],
): void {
  const issue = (code: string, subPath: string, message: string) =>
    issues.push({ code, path: subPath ? `${path}.${subPath}` : path, message });

  if (parameters.weightGroups[a.weightGroup] === undefined) {
    issue('UNKNOWN_WEIGHT_GROUP', 'weightGroup', `'${a.weightGroup}' is not a declared weight group`);
  }

  // COHORT_BAND is only defined for a total score (§3.1, §4.3): the
  // requirements pair it exclusively with SINGLE_SCORE.
  if (a.scoringRule === 'COHORT_BAND' && a.shape !== 'SINGLE_SCORE') {
    issue('BAD_SHAPE_CONFIG', 'scoringRule', 'COHORT_BAND applies to a total score and requires shape SINGLE_SCORE');
  }
  if (a.scoringRule === 'COHORT_BAND' && parameters.cohortBands.length === 0) {
    issue('BAD_SHAPE_CONFIG', 'scoringRule', 'COHORT_BAND assessment requires a non-empty cohortBands table');
  }

  // Shape-specific structure. Fields belonging to another shape are
  // rejected outright: a mixed configuration is ambiguous, and ambiguity
  // is an error here, not a guess.
  const itemIds = new Set<string>();
  if (a.shape === 'SECTIONED') {
    if (a.items !== undefined) issue('BAD_SHAPE_CONFIG', 'items', 'SECTIONED assessments carry items inside sections');
    if (a.maxMark !== undefined) issue('BAD_SHAPE_CONFIG', 'maxMark', 'maxMark belongs to SINGLE_SCORE only');
    if (a.coTags !== undefined) issue('BAD_SHAPE_CONFIG', 'coTags', 'SECTIONED assessments tag COs per item, not per assessment');
    if (!a.sections || a.sections.length === 0) {
      issue('BAD_SHAPE_CONFIG', 'sections', 'SECTIONED assessment requires at least one section');
    } else {
      const sectionIds = new Set<string>();
      a.sections.forEach((s, si) => {
        if (sectionIds.has(s.id)) issue('DUPLICATE_ID', `sections[${si}]`, `duplicate section id '${s.id}'`);
        sectionIds.add(s.id);
        if (s.items.length === 0) issue('BAD_SHAPE_CONFIG', `sections[${si}].items`, `section '${s.id}' has no items`);
        s.items.forEach((it, ii) => validateItem(it, coIdSet, itemIds, `${path}.sections[${si}].items[${ii}]`, issues));
      });
    }
  } else if (a.shape === 'ITEM_LIST') {
    if (a.sections !== undefined) issue('BAD_SHAPE_CONFIG', 'sections', 'sections belong to SECTIONED only');
    if (a.maxMark !== undefined) issue('BAD_SHAPE_CONFIG', 'maxMark', 'maxMark belongs to SINGLE_SCORE only');
    if (a.coTags !== undefined) issue('BAD_SHAPE_CONFIG', 'coTags', 'ITEM_LIST assessments tag COs per item, not per assessment');
    if (!a.items || a.items.length === 0) {
      issue('BAD_SHAPE_CONFIG', 'items', 'ITEM_LIST assessment requires at least one item');
    } else {
      a.items.forEach((it, ii) => validateItem(it, coIdSet, itemIds, `${path}.items[${ii}]`, issues));
    }
  } else {
    // SINGLE_SCORE
    if (a.sections !== undefined) issue('BAD_SHAPE_CONFIG', 'sections', 'sections belong to SECTIONED only');
    if (a.items !== undefined) issue('BAD_SHAPE_CONFIG', 'items', 'items belong to ITEM_LIST only');
    if (!isFiniteNumber(a.maxMark) || a.maxMark <= 0) {
      issue('BAD_SHAPE_CONFIG', 'maxMark', `SINGLE_SCORE assessment requires maxMark > 0, got ${a.maxMark}`);
    }
    for (const tag of a.coTags ?? []) {
      if (!coIdSet.has(tag)) issue('UNKNOWN_CO_TAG', 'coTags', `'${tag}' is not a CO of this course`);
    }
    // The single score is keyed in `marks` by the assessment's own id.
    itemIds.add(a.id);
  }

  // Marks: null = did not attempt (and only null — never undefined or NaN);
  // numbers must lie in [0, item maximum]. Zero is a real, attempted mark.
  const maxByItem = new Map<string, number>();
  if (a.shape === 'SECTIONED') {
    for (const s of a.sections ?? []) for (const it of s.items) maxByItem.set(it.id, it.maxMark);
  } else if (a.shape === 'ITEM_LIST') {
    for (const it of a.items ?? []) maxByItem.set(it.id, it.maxMark);
  } else if (isFiniteNumber(a.maxMark)) {
    maxByItem.set(a.id, a.maxMark);
  }
  for (const [enrolmentId, row] of Object.entries(a.marks)) {
    for (const [itemId, mark] of Object.entries(row)) {
      const markPath = `${path}.marks.${enrolmentId}.${itemId}`;
      if (!itemIds.has(itemId)) {
        issue('UNKNOWN_ITEM_IN_MARKS', `marks.${enrolmentId}.${itemId}`, `'${itemId}' is not an item of this assessment`);
        continue;
      }
      if (mark === null) continue;
      if (!isFiniteNumber(mark)) {
        issues.push({
          code: 'BAD_MARK',
          path: markPath,
          message: `a mark must be a finite number or null (null = did not attempt), got ${JSON.stringify(mark)}`,
        });
        continue;
      }
      const max = maxByItem.get(itemId);
      if (mark < 0 || (max !== undefined && mark > max)) {
        issues.push({ code: 'MARK_OUT_OF_RANGE', path: markPath, message: `mark ${mark} outside [0, ${max}]` });
      }
    }
  }
}

/** Returns every problem found; an empty array means the input is computable. */
export function validateCourseInput(input: CourseInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // COs
  const coIdSet = new Set<string>();
  if (input.cos.length === 0) {
    issues.push({ code: 'NO_COS', path: 'cos', message: 'a course must define at least one CO' });
  }
  input.cos.forEach((co, i) => {
    if (!co.id) issues.push({ code: 'BAD_ID', path: `cos[${i}].id`, message: 'CO id must be a non-empty string' });
    if (coIdSet.has(co.id)) issues.push({ code: 'DUPLICATE_ID', path: `cos[${i}].id`, message: `duplicate CO id '${co.id}'` });
    coIdSet.add(co.id);
  });

  issues.push(...validateParameters(input.parameters));

  // Articulation matrix: rows must be known COs; strengths 1|2|3|null.
  for (const [coId, row] of Object.entries(input.poMatrix)) {
    if (!coIdSet.has(coId)) {
      issues.push({ code: 'BAD_MATRIX', path: `poMatrix.${coId}`, message: `'${coId}' is not a CO of this course` });
      continue;
    }
    for (const [poId, strength] of Object.entries(row)) {
      if (strength !== null && strength !== 1 && strength !== 2 && strength !== 3) {
        issues.push({
          code: 'BAD_MATRIX',
          path: `poMatrix.${coId}.${poId}`,
          message: `mapping strength must be 1, 2, 3 or null, got ${JSON.stringify(strength)}`,
        });
      }
    }
  }

  // Assessments
  const assessmentIds = new Set<string>();
  input.assessments.forEach((a, i) => {
    const path = `assessments[${i}]`;
    if (!a.id) issues.push({ code: 'BAD_ID', path: `${path}.id`, message: 'assessment id must be a non-empty string' });
    if (assessmentIds.has(a.id)) {
      issues.push({ code: 'DUPLICATE_ID', path: `${path}.id`, message: `duplicate assessment id '${a.id}'` });
    }
    assessmentIds.add(a.id);
    validateAssessment(a, coIdSet, input.parameters, path, issues);
  });

  // Indirect feedback: keys must be known COs; counts non-negative integers.
  for (const [coId, counts] of Object.entries(input.indirect)) {
    if (!coIdSet.has(coId)) {
      issues.push({ code: 'BAD_INDIRECT', path: `indirect.${coId}`, message: `'${coId}' is not a CO of this course` });
      continue;
    }
    for (const key of ['n1', 'n2', 'n3'] as const) {
      const n = counts[key];
      if (!Number.isInteger(n) || n < 0) {
        issues.push({
          code: 'BAD_INDIRECT',
          path: `indirect.${coId}.${key}`,
          message: `response count must be a non-negative integer, got ${JSON.stringify(n)}`,
        });
      }
    }
  }

  return issues;
}

/** Throws EngineValidationError when the input is not computable. */
export function assertValidCourseInput(input: CourseInput): void {
  const issues = validateCourseInput(input);
  if (issues.length > 0) throw new EngineValidationError(issues);
}
