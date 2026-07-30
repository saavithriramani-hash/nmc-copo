import { DEFAULT_PARAMETERS, computeCourse } from '@copo/engine';
import type { CourseInput } from '@copo/engine';
import type { ExportInput } from '../src/types';

/**
 * The same worked course the engine's own end-to-end test uses: two
 * sectioned internal tests, an untagged assignment, a quiz, a seminar and
 * a cohort-banded end-semester paper; five students, three COs, two POs
 * (one of which co2 does not map to).
 *
 * Its hand-computed values are known, so the export test can assert both
 * that the workbook's formulas agree with the engine AND that the engine
 * still produces the figures worked out by hand.
 */
export function buildCourseInput(): CourseInput {
  return {
    cos: [
      { id: 'co1', statement: 'Statement one', bloomLevels: ['Understand'] },
      { id: 'co2', statement: 'Statement two', bloomLevels: ['Apply'] },
      { id: 'co3', statement: 'Statement three', bloomLevels: ['Analyse'] },
    ],
    poMatrix: {
      co1: { po1: 3, po2: 1 },
      co2: { po1: 2, po2: null },
      co3: { po1: 3, po2: 2 },
    },
    parameters: { ...DEFAULT_PARAMETERS },
    assessments: [
      {
        id: 'cia1',
        name: 'Internal Test I',
        shape: 'SECTIONED',
        scoringRule: 'RUBRIC',
        weightGroup: 'internal',
        sections: [
          {
            id: 'secA',
            name: 'Section A',
            items: [
              { id: 'q1', maxMark: 2, coTag: 'co1' },
              { id: 'q2', maxMark: 2, coTag: 'co2' },
            ],
          },
          {
            id: 'secB',
            name: 'Section B',
            items: [
              { id: 'q3', maxMark: 5, coTag: 'co1' },
              { id: 'q4', maxMark: 5, coTag: 'co2' },
            ],
          },
        ],
        marks: {
          S1: { q1: 2, q2: 2, q3: 5, q4: 5 },
          S2: { q1: 2, q2: 2, q3: 4, q4: 4 },
          S3: { q1: 2, q2: 2, q3: 3.5, q4: 3 },
          S4: { q1: 1, q2: 2, q3: 3, q4: 2 },
          S5: { q1: null, q2: 0, q3: 2, q4: null },
        },
      },
      {
        id: 'cia2',
        name: 'Internal Test II',
        shape: 'SECTIONED',
        scoringRule: 'RUBRIC',
        weightGroup: 'internal',
        sections: [
          {
            id: 'secA2',
            name: 'Section A',
            items: [
              { id: 'r1', maxMark: 2, coTag: 'co2' },
              { id: 'r2', maxMark: 2, coTag: 'co3' },
            ],
          },
          { id: 'secB2', name: 'Section B', items: [{ id: 'r3', maxMark: 10, coTag: 'co3' }] },
        ],
        marks: {
          S1: { r1: 2, r2: 2, r3: 10 },
          S2: { r1: 2, r2: 2, r3: 9 },
          S3: { r1: 1, r2: 2, r3: 8 },
          S4: { r1: 1, r2: 1, r3: 7 },
          S5: { r1: 1, r2: null, r3: 6 },
        },
      },
      {
        id: 'assign',
        name: 'Assignment',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        items: [{ id: 'a1', maxMark: 5, coTag: null }],
        marks: { S1: { a1: 5 }, S2: { a1: 4 }, S3: { a1: 4 }, S4: { a1: 3.5 }, S5: { a1: 3 } },
      },
      {
        id: 'quiz',
        name: 'Quiz',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        items: [
          { id: 'z1', maxMark: 1, coTag: 'co1' },
          { id: 'z2', maxMark: 1, coTag: 'co2' },
        ],
        marks: {
          S1: { z1: 1, z2: 1 },
          S2: { z1: 1, z2: 1 },
          S3: { z1: 1, z2: null },
          S4: { z1: 0, z2: null },
          S5: { z1: null, z2: null },
        },
      },
      {
        id: 'seminar',
        name: 'Seminar',
        shape: 'SINGLE_SCORE',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        maxMark: 10,
        coTags: ['co3'],
        marks: { S1: { seminar: 9 }, S2: { seminar: 8 }, S3: { seminar: 7 }, S4: { seminar: 7 }, S5: { seminar: 5 } },
      },
      {
        id: 'endsem',
        name: 'End-Semester Examination',
        shape: 'SINGLE_SCORE',
        scoringRule: 'COHORT_BAND',
        weightGroup: 'external',
        maxMark: 75,
        marks: { S1: { endsem: 60 }, S2: { endsem: 45 }, S3: { endsem: 44 }, S4: { endsem: 40 }, S5: { endsem: 30 } },
      },
    ],
    indirect: {
      co1: { n1: 1, n2: 1, n3: 8 },
      co2: { n1: 0, n2: 5, n3: 5 },
      co3: { n1: 2, n2: 3, n3: 5 },
    },
  };
}

export function buildExportInput(overrides: Partial<ExportInput> = {}): ExportInput {
  const input = buildCourseInput();
  const result = computeCourse(input);
  return {
    course: {
      code: 'MAT301',
      title: 'Real Analysis',
      semester: 3,
      departmentName: 'Mathematics',
      programmeName: 'B.Sc. Mathematics',
      batchName: '2024–2027',
      status: 'DRAFT',
      snapshotVersion: null,
      engineVersion: '0.1.0',
      generatedAt: new Date('2026-07-24T12:00:00Z'),
    },
    input,
    result,
    refs: {
      coCodeById: { co1: 'CO1', co2: 'CO2', co3: 'CO3' },
      poCodeById: { po1: 'PO1', po2: 'PO2' },
      assessmentNameById: {
        cia1: 'Internal Test I',
        cia2: 'Internal Test II',
        assign: 'Assignment',
        quiz: 'Quiz',
        seminar: 'Seminar',
        endsem: 'End-Semester Examination',
      },
      sectionNameById: { secA: 'Section A', secB: 'Section B', secA2: 'Section A', secB2: 'Section B' },
      itemLabelById: {
        q1: 'Q1',
        q2: 'Q2',
        q3: 'Q3',
        q4: 'Q4',
        r1: 'Q1',
        r2: 'Q2',
        r3: 'Q3',
        a1: 'Assignment',
        z1: 'Z1',
        z2: 'Z2',
        seminar: 'Seminar score',
        endsem: 'Total',
      },
    },
    provenance: {
      thresholdFraction: 'institution',
      bands: 'institution',
      cohortBands: 'institution',
      weightGroups: 'programme',
      directWeight: 'institution',
      indirectWeight: 'institution',
      targetAttainment: 'course',
      feedbackResponseFloor: 'institution',
    },
    ...overrides,
  };
}
