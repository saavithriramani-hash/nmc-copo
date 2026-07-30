import { DEFAULT_PARAMETERS, computeCourse } from '@copo/engine';
import type { CourseInput } from '@copo/engine';
import type { ConsolidationReportData, CourseReportData } from '../src/types';
import type { CourseRow } from '../src/grouping';

/**
 * The same worked course the engine's end-to-end test uses, so the
 * rendered figures are ones whose correct values are known by hand.
 */
export function buildCourseInput(): CourseInput {
  return {
    cos: [
      { id: 'co1', statement: 'Recall the completeness property of the real line', bloomLevels: ['Remember'] },
      { id: 'co2', statement: 'Explain convergence of sequences and series', bloomLevels: ['Understand'] },
      { id: 'co3', statement: 'Apply convergence tests to concrete series', bloomLevels: ['Apply'] },
    ],
    poMatrix: { co1: { po1: 3, po2: 1 }, co2: { po1: 2, po2: null }, co3: { po1: 3, po2: 2 } },
    parameters: { ...DEFAULT_PARAMETERS },
    assessments: [
      {
        id: 'cia1',
        name: 'Internal Test I',
        shape: 'SECTIONED',
        scoringRule: 'RUBRIC',
        weightGroup: 'internal',
        sections: [
          { id: 'secA', name: 'Section A', items: [{ id: 'q1', maxMark: 2, coTag: 'co1' }, { id: 'q2', maxMark: 2, coTag: 'co2' }] },
          { id: 'secB', name: 'Section B', items: [{ id: 'q3', maxMark: 5, coTag: 'co1' }, { id: 'q4', maxMark: 5, coTag: 'co2' }] },
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
          { id: 'secA2', name: 'Section A', items: [{ id: 'r1', maxMark: 2, coTag: 'co2' }, { id: 'r2', maxMark: 2, coTag: 'co3' }] },
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
        items: [{ id: 'z1', maxMark: 1, coTag: 'co1' }, { id: 'z2', maxMark: 1, coTag: 'co2' }],
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
    indirect: { co1: { n1: 1, n2: 1, n3: 8 }, co2: { n1: 0, n2: 5, n3: 5 }, co3: { n1: 2, n2: 3, n3: 5 } },
  };
}

export function buildCourseReportData(overrides: Partial<CourseReportData> = {}): CourseReportData {
  const input = buildCourseInput();
  const result = computeCourse(input);
  return {
    course: {
      code: 'MAT301',
      title: 'Real Analysis',
      semester: 3,
      credits: '4',
      departmentName: 'Mathematics',
      programmeName: 'B.Sc. Mathematics',
      batchName: '2024–2027',
      status: 'LOCKED',
      facultyNames: ['Course Faculty'],
      enrolmentCount: 5,
      snapshotVersion: 2,
      lockedAt: new Date('2026-07-20T10:00:00Z'),
      lockedBy: 'HoD Mathematics',
      engineVersion: '0.1.0',
      generatedAt: new Date('2026-07-24T12:00:00Z'),
    },
    cos: [
      { id: 'co1', code: 'CO1', statement: 'Recall the completeness property of the real line', bloomLevels: ['Remember'] },
      { id: 'co2', code: 'CO2', statement: 'Explain convergence of sequences and series', bloomLevels: ['Understand'] },
      { id: 'co3', code: 'CO3', statement: 'Apply convergence tests to concrete series', bloomLevels: ['Apply'] },
    ],
    pos: [
      { id: 'po1', code: 'PO1', kind: 'PO', statement: 'Disciplinary knowledge' },
      { id: 'po2', code: 'PO2', kind: 'PO', statement: 'Critical thinking and problem solving' },
    ],
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
        q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4',
        r1: 'Q1', r2: 'Q2', r3: 'Q3',
        a1: 'Assignment', z1: 'Z1', z2: 'Z2',
        seminar: 'Seminar', endsem: 'Total',
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

export function buildCourseRows(count: number): CourseRow[] {
  const departments = ['Mathematics', 'Physics'];
  const programmes = ['B.Sc. Mathematics', 'M.Sc. Mathematics', 'B.Sc. Physics'];
  return Array.from({ length: count }, (_, index) => ({
    courseId: `c${index}`,
    code: `MAT${300 + index}`,
    title: `Course number ${index}`,
    semester: (index % 6) + 1,
    batchName: index % 2 === 0 ? '2024–2027' : '2023–2026',
    programmeName: programmes[index % programmes.length]!,
    departmentName: index % programmes.length === 2 ? departments[1]! : departments[0]!,
    po: {
      PO1: index % 7 === 0 ? null : 1 + (index % 20) / 10,
      PO2: 1.5 + (index % 10) / 10,
      PSO1: index % 5 === 0 ? null : 2 + (index % 8) / 10,
    },
    warningCount: index % 4 === 0 ? 2 : 0,
    ...(index % 11 === 0 ? { error: 'Course input failed validation' } : {}),
  }));
}

export function buildConsolidationData(rowCount = 24, overrides: Partial<ConsolidationReportData> = {}): ConsolidationReportData {
  return {
    meta: {
      scopeLabel: 'B.Sc. Mathematics',
      scopeContext: 'Mathematics',
      filter: {},
      generatedAt: new Date('2026-07-24T12:00:00Z'),
      engineVersion: '0.1.0',
    },
    poCodes: ['PO1', 'PO2', 'PSO1'],
    poStatements: [
      { code: 'PO1', statement: 'Disciplinary knowledge' },
      { code: 'PO2', statement: 'Critical thinking and problem solving' },
      { code: 'PSO1', statement: 'Apply mathematical structures to concrete problems' },
    ],
    rows: buildCourseRows(rowCount),
    trend: [
      { batchName: '2021–2024', meanPo: 1.8 },
      { batchName: '2022–2025', meanPo: null },
      { batchName: '2023–2026', meanPo: 2.1 },
      { batchName: '2024–2027', meanPo: 2.35 },
    ],
    target: 2.5,
    ...overrides,
  };
}
