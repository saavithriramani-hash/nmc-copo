import { describe, expect, it } from 'vitest';
import { EngineValidationError, computeCourse, validateCourseInput } from '../src/index';
import type { Assessment, CourseInput } from '../src/index';
import { makeCo, makeParams } from './fixtures/helpers';

function minimalCourse(mutate: (c: CourseInput) => void = () => {}): CourseInput {
  const course: CourseInput = {
    cos: [makeCo('co1'), makeCo('co2')],
    poMatrix: { co1: { po1: 3 }, co2: { po1: 2 } },
    parameters: makeParams(),
    assessments: [
      {
        id: 'a1',
        name: 'Assignment',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        items: [{ id: 'i1', maxMark: 5, coTag: 'co1' }],
        marks: { S1: { i1: 5 }, S2: { i1: 0 }, S3: { i1: null } },
      },
    ],
    indirect: { co1: { n1: 1, n2: 2, n3: 3 } },
  };
  mutate(course);
  return course;
}

function codesOf(course: CourseInput): string[] {
  return validateCourseInput(course).map((i) => i.code);
}

describe('validateCourseInput — a well-formed course has no issues', () => {
  it('accepts the minimal course (including a real 0 and a real null mark)', () => {
    expect(validateCourseInput(minimalCourse())).toEqual([]);
  });

  it('accepts the default weight groups (0.2 + 0.1 + 0.7 within float tolerance)', () => {
    expect(codesOf(minimalCourse())).toEqual([]);
  });
});

describe('validateCourseInput — impossible inputs are errors, not warnings', () => {
  it('a mark above the item maximum', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.marks['S1'] = { i1: 6 })))).toContain('MARK_OUT_OF_RANGE');
  });

  it('a negative mark', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.marks['S1'] = { i1: -1 })))).toContain('MARK_OUT_OF_RANGE');
  });

  it('NaN and undefined never impersonate a blank: only null means "did not attempt"', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.marks['S1'] = { i1: Number.NaN })))).toContain('BAD_MARK');
    expect(
      codesOf(minimalCourse((c) => (c.assessments[0]!.marks['S1'] = { i1: undefined as unknown as null }))),
    ).toContain('BAD_MARK');
  });

  it('marks for an unknown item', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.marks['S1'] = { ghost: 3 })))).toContain(
      'UNKNOWN_ITEM_IN_MARKS',
    );
  });

  it('an item tagged to a CO the course does not define', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.items![0]!.coTag = 'co9')))).toContain('UNKNOWN_CO_TAG');
  });

  it('an assessment in an undeclared weight group', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.weightGroup = 'nope')))).toContain('UNKNOWN_WEIGHT_GROUP');
  });

  it('weight groups that do not sum to 1.00', () => {
    expect(
      codesOf(minimalCourse((c) => (c.parameters = makeParams({ weightGroups: { continuous: 0.5, external: 0.4 } })))),
    ).toContain('BAD_WEIGHTS');
  });

  it('a zero or negative group weight (declare only the groups you weight)', () => {
    expect(
      codesOf(minimalCourse((c) => (c.parameters = makeParams({ weightGroups: { continuous: 1, ghost: 0 } })))),
    ).toContain('BAD_WEIGHTS');
  });

  it('direct + indirect weights that do not sum to 1.00', () => {
    expect(codesOf(minimalCourse((c) => (c.parameters = makeParams({ directWeight: 0.8 }))))).toContain('BAD_WEIGHTS');
  });

  it('a threshold fraction outside (0, 1]', () => {
    expect(codesOf(minimalCourse((c) => (c.parameters = makeParams({ thresholdFraction: 0 }))))).toContain(
      'BAD_THRESHOLD',
    );
    expect(codesOf(minimalCourse((c) => (c.parameters = makeParams({ thresholdFraction: 1.2 }))))).toContain(
      'BAD_THRESHOLD',
    );
  });

  it('a band table without a lowerBound-0 row, or with duplicate bounds', () => {
    expect(
      codesOf(minimalCourse((c) => (c.parameters = makeParams({ bands: [{ lowerBound: 40, level: 1 }] })))),
    ).toContain('BAD_BANDS');
    expect(
      codesOf(
        minimalCourse(
          (c) =>
            (c.parameters = makeParams({
              bands: [
                { lowerBound: 40, level: 1 },
                { lowerBound: 40, level: 2 },
                { lowerBound: 0, level: 0 },
              ],
            })),
        ),
      ),
    ).toContain('BAD_BANDS');
  });

  it('a band level given as the string "3" — levels are integers, never strings (§9)', () => {
    expect(
      codesOf(
        minimalCourse(
          (c) =>
            (c.parameters = makeParams({
              bands: [
                { lowerBound: 80, level: '3' as unknown as 3 },
                { lowerBound: 0, level: 0 },
              ],
            })),
        ),
      ),
    ).toContain('BAD_BANDS');
  });

  it('duplicate cohort-band levels', () => {
    expect(
      codesOf(
        minimalCourse(
          (c) =>
            (c.parameters = makeParams({
              cohortBands: [
                { scorePercent: 60, cohortPercent: 50, level: 3 },
                { scorePercent: 50, cohortPercent: 50, level: 3 },
              ],
            })),
        ),
      ),
    ).toContain('BAD_COHORT_BANDS');
  });

  it('COHORT_BAND on a shape other than SINGLE_SCORE (only defined for a total score, §3.1)', () => {
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.scoringRule = 'COHORT_BAND')))).toContain(
      'BAD_SHAPE_CONFIG',
    );
  });

  it('shape/field mismatches are rejected, not guessed at', () => {
    // ITEM_LIST with no items
    expect(codesOf(minimalCourse((c) => delete c.assessments[0]!.items))).toContain('BAD_SHAPE_CONFIG');
    // ITEM_LIST with a maxMark
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.maxMark = 10)))).toContain('BAD_SHAPE_CONFIG');
    // ITEM_LIST with assessment-level coTags (tags live on items for this shape)
    expect(codesOf(minimalCourse((c) => (c.assessments[0]!.coTags = ['co1'])))).toContain('BAD_SHAPE_CONFIG');
    // SINGLE_SCORE without maxMark
    const singleScore: Assessment = {
      id: 'ss',
      name: 'Seminar',
      shape: 'SINGLE_SCORE',
      scoringRule: 'RUBRIC',
      weightGroup: 'continuous',
      marks: {},
    };
    expect(codesOf(minimalCourse((c) => c.assessments.push(singleScore)))).toContain('BAD_SHAPE_CONFIG');
    // SECTIONED without sections
    const sectioned: Assessment = {
      id: 'sec',
      name: 'CIA',
      shape: 'SECTIONED',
      scoringRule: 'RUBRIC',
      weightGroup: 'internal',
      marks: {},
    };
    expect(codesOf(minimalCourse((c) => c.assessments.push(sectioned)))).toContain('BAD_SHAPE_CONFIG');
  });

  it('duplicate ids: COs, assessments, items', () => {
    expect(codesOf(minimalCourse((c) => c.cos.push(makeCo('co1'))))).toContain('DUPLICATE_ID');
    expect(codesOf(minimalCourse((c) => c.assessments.push({ ...c.assessments[0]! })))).toContain('DUPLICATE_ID');
    expect(
      codesOf(minimalCourse((c) => c.assessments[0]!.items!.push({ id: 'i1', maxMark: 5, coTag: null }))),
    ).toContain('DUPLICATE_ID');
  });

  it('an articulation matrix with unknown COs or out-of-range strengths', () => {
    expect(codesOf(minimalCourse((c) => (c.poMatrix['co9'] = { po1: 3 })))).toContain('BAD_MATRIX');
    expect(codesOf(minimalCourse((c) => (c.poMatrix['co1'] = { po1: 4 as unknown as 3 })))).toContain('BAD_MATRIX');
    expect(codesOf(minimalCourse((c) => (c.poMatrix['co1'] = { po1: '3' as unknown as 3 })))).toContain('BAD_MATRIX');
  });

  it('indirect feedback with unknown COs or bad counts', () => {
    expect(codesOf(minimalCourse((c) => (c.indirect['co9'] = { n1: 1, n2: 1, n3: 1 })))).toContain('BAD_INDIRECT');
    expect(codesOf(minimalCourse((c) => (c.indirect['co1'] = { n1: -1, n2: 0, n3: 0 })))).toContain('BAD_INDIRECT');
    expect(codesOf(minimalCourse((c) => (c.indirect['co1'] = { n1: 1.5, n2: 0, n3: 0 })))).toContain('BAD_INDIRECT');
  });

  it('a course with no COs', () => {
    expect(codesOf(minimalCourse((c) => (c.cos = [])))).toContain('NO_COS');
  });
});

describe('computeCourse refuses invalid input with a structured error', () => {
  it('throws EngineValidationError carrying every issue', () => {
    const bad = minimalCourse((c) => {
      c.assessments[0]!.marks['S1'] = { i1: 99 };
      c.parameters = makeParams({ thresholdFraction: 2 });
    });
    try {
      computeCourse(bad);
      expect.unreachable('computeCourse must throw on invalid input');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineValidationError);
      const issues = (err as EngineValidationError).issues;
      expect(issues.some((i) => i.code === 'MARK_OUT_OF_RANGE')).toBe(true);
      expect(issues.some((i) => i.code === 'BAD_THRESHOLD')).toBe(true);
    }
  });
});
