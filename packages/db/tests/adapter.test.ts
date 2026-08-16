import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { DEFAULT_PARAMETERS, computeCourse, validateCourseInput } from '@copo/engine';
import { AdapterError, buildCourseInput } from '../src/index';
import type { CourseForInput, MarkRow } from '../src/index';

/**
 * Pure adapter tests: database ROW SHAPES in, engine CourseInput out.
 * No database needed — buildCourseInput is a pure function. These verify
 * the mapping only; calculation correctness rests entirely on the
 * engine's hand-computed fixtures.
 */

const D = (v: number | string) => new Prisma.Decimal(v);
const NOW = new Date('2026-07-24T00:00:00Z');

const NULL_OVERRIDES = {
  thresholdFraction: null,
  bands: null,
  cohortBands: null,
  weightGroups: null,
  directWeight: null,
  indirectWeight: null,
  targetAttainment: null,
  feedbackResponseFloor: null,
};

type CourseOverrides = Partial<CourseForInput>;

function fixtureCourse(overrides: CourseOverrides = {}): CourseForInput {
  const institution = {
    id: 'inst',
    name: 'NMC',
    thresholdFraction: D('0.7'),
    bands: DEFAULT_PARAMETERS.bands as unknown as Prisma.JsonValue,
    cohortBands: DEFAULT_PARAMETERS.cohortBands as unknown as Prisma.JsonValue,
    weightGroups: DEFAULT_PARAMETERS.weightGroups as unknown as Prisma.JsonValue,
    directWeight: D('0.9'),
    indirectWeight: D('0.1'),
    targetAttainment: D('2.5'),
    feedbackResponseFloor: 0,
    // CR-8: nullable at every level, and null here deliberately — the
    // ten steps do not read it, so the adapter must not care.
    learnerBands: null as Prisma.JsonValue,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const course: CourseForInput = {
    id: 'course-1',
    batchId: 'batch-1',
    code: 'MAT301',
    title: 'Real Analysis',
    semester: 3,
    credits: D('4'),
    status: 'DRAFT',
    // CR-3: a theory paper. Authorisation only — the adapter and the
    // engine behind it are indifferent to the flag.
    isLaboratory: false,
    ...NULL_OVERRIDES,
    createdAt: NOW,
    updatedAt: NOW,
    batch: {
      id: 'batch-1',
      programmeId: 'prog-1',
      name: '2024–2027',
      startYear: 2024,
      endYear: 2027,
      programme: {
        id: 'prog-1',
        departmentId: 'dept-1',
        name: 'B.Sc. Mathematics',
        ...NULL_OVERRIDES,
        learnerBands: null as Prisma.JsonValue,
        department: { id: 'dept-1', institutionId: 'inst', name: 'Mathematics', institution },
        outcomes: [
          { id: 'po1', programmeId: 'prog-1', code: 'PO1', kind: 'PO', statement: 'Knowledge', displayOrder: 1 },
          { id: 'po2', programmeId: 'prog-1', code: 'PO2', kind: 'PO', statement: 'Reasoning', displayOrder: 2 },
          { id: 'pso1', programmeId: 'prog-1', code: 'PSO1', kind: 'PSO', statement: 'Proofs', displayOrder: 3 },
        ],
      },
    },
    cos: [
      {
        id: 'co1',
        courseId: 'course-1',
        code: 'CO1',
        statement: 'Statement one',
        bloomLevels: ['Understand'],
        displayOrder: 1,
        matrixEntries: [
          { coId: 'co1', poId: 'po1', strength: 3 },
          { coId: 'co1', poId: 'pso1', strength: 1 },
        ],
        indirect: { coId: 'co1', n1: 1, n2: 2, n3: 7, updatedAt: NOW },
      },
      {
        id: 'co2',
        courseId: 'course-1',
        code: 'CO2',
        statement: 'Statement two',
        bloomLevels: ['Apply'],
        displayOrder: 2,
        matrixEntries: [{ coId: 'co2', poId: 'po1', strength: 2 }],
        indirect: null, // no feedback row: must reach the engine as "absent"
      },
    ],
    assessments: [
      {
        id: 'cia1',
        courseId: 'course-1',
        name: 'Internal Test I',
        shape: 'SECTIONED',
        scoringRule: 'RUBRIC',
        weightGroup: 'internal',
        displayOrder: 1,
        sections: [
          {
            id: 'secA',
            assessmentId: 'cia1',
            name: 'Section A',
            displayOrder: 1,
            optionalAnswerCount: null,
            items: [
              { id: 'q1', assessmentId: 'cia1', sectionId: 'secA', label: 'Q1', maxMark: D('2'), coId: 'co1', displayOrder: 1, bloomLevel: null },
              { id: 'q2', assessmentId: 'cia1', sectionId: 'secA', label: 'Q2', maxMark: D('5'), coId: null, displayOrder: 2, bloomLevel: null },
            ],
          },
        ],
        items: [
          { id: 'q1', assessmentId: 'cia1', sectionId: 'secA', label: 'Q1', maxMark: D('2'), coId: 'co1', displayOrder: 1, bloomLevel: null },
          { id: 'q2', assessmentId: 'cia1', sectionId: 'secA', label: 'Q2', maxMark: D('5'), coId: null, displayOrder: 2, bloomLevel: null },
        ],
        coTags: [],
      },
      {
        id: 'quiz1',
        courseId: 'course-1',
        name: 'Quiz 1',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'continuous',
        displayOrder: 2,
        sections: [],
        items: [
          { id: 'z1', assessmentId: 'quiz1', sectionId: null, label: 'Q1', maxMark: D('1'), coId: 'co2', displayOrder: 1, bloomLevel: null },
        ],
        coTags: [],
      },
      {
        id: 'endsem',
        courseId: 'course-1',
        name: 'End-Semester',
        shape: 'SINGLE_SCORE',
        scoringRule: 'COHORT_BAND',
        weightGroup: 'external',
        displayOrder: 3,
        sections: [],
        items: [
          { id: 'endsem-score', assessmentId: 'endsem', sectionId: null, label: 'Total', maxMark: D('75'), coId: null, displayOrder: 1, bloomLevel: null },
        ],
        coTags: [],
      },
    ],
    ...overrides,
  };
  return course;
}

const MARKS: MarkRow[] = [
  { enrolmentId: 'enr-1', itemId: 'q1', assessmentId: 'cia1', value: D('1.5') },
  { enrolmentId: 'enr-1', itemId: 'q2', assessmentId: 'cia1', value: D('3.5') },
  { enrolmentId: 'enr-2', itemId: 'q1', assessmentId: 'cia1', value: null }, // explicit blank
  { enrolmentId: 'enr-1', itemId: 'z1', assessmentId: 'quiz1', value: D('1') },
  { enrolmentId: 'enr-1', itemId: 'endsem-score', assessmentId: 'endsem', value: D('45') },
  { enrolmentId: 'enr-2', itemId: 'endsem-score', assessmentId: 'endsem', value: D('30') },
];

describe('buildCourseInput — structure mapping', () => {
  const { input, parameterResolution, refs } = buildCourseInput(fixtureCourse(), MARKS);

  it('produces an input the engine accepts without validation issues', () => {
    expect(validateCourseInput(input)).toEqual([]);
    expect(() => computeCourse(input)).not.toThrow();
  });

  it('maps COs in display order with statements and Bloom levels', () => {
    expect(input.cos).toEqual([
      { id: 'co1', statement: 'Statement one', bloomLevels: ['Understand'] },
      { id: 'co2', statement: 'Statement two', bloomLevels: ['Apply'] },
    ]);
  });

  it('gives every programme PO a column; missing cells are null (unmapped), never 0', () => {
    expect(input.poMatrix).toEqual({
      co1: { po1: 3, po2: null, pso1: 1 },
      co2: { po1: 2, po2: null, pso1: null },
    });
  });

  it('converts Decimal marks to numbers and keeps null marks null', () => {
    const cia1 = input.assessments.find((a) => a.id === 'cia1')!;
    expect(cia1.marks['enr-1']).toEqual({ q1: 1.5, q2: 3.5 });
    expect(cia1.marks['enr-2']).toEqual({ q1: null }); // blank survives verbatim
  });

  it('maps SECTIONED assessments with items nested in sections and per-item CO tags', () => {
    const cia1 = input.assessments.find((a) => a.id === 'cia1')!;
    expect(cia1.shape).toBe('SECTIONED');
    expect(cia1.sections).toEqual([
      {
        id: 'secA',
        name: 'Section A',
        items: [
          { id: 'q1', maxMark: 2, coTag: 'co1' },
          { id: 'q2', maxMark: 5, coTag: null },
        ],
      },
    ]);
    expect(cia1.items).toBeUndefined();
    expect(cia1.maxMark).toBeUndefined();
  });

  it('re-keys the SINGLE_SCORE mark under the assessment id, as the engine expects', () => {
    const endsem = input.assessments.find((a) => a.id === 'endsem')!;
    expect(endsem.maxMark).toBe(75);
    expect(endsem.marks).toEqual({
      'enr-1': { endsem: 45 },
      'enr-2': { endsem: 30 },
    });
    expect(endsem.coTags).toBeUndefined(); // untagged → engine applies it to every CO
  });

  it('maps indirect feedback only for COs that have a row', () => {
    expect(input.indirect).toEqual({ co1: { n1: 1, n2: 2, n3: 7 } });
  });

  it('resolves parameters with provenance all-institution when nothing overrides', () => {
    expect(parameterResolution.parameters).toEqual(DEFAULT_PARAMETERS);
    for (const source of Object.values(parameterResolution.provenance)) {
      expect(source).toBe('institution');
    }
  });

  it('exposes display-code maps for reports', () => {
    expect(refs.coCodeById).toEqual({ co1: 'CO1', co2: 'CO2' });
    expect(refs.poCodeById).toEqual({ po1: 'PO1', po2: 'PO2', pso1: 'PSO1' });
  });
});

describe('buildCourseInput — parameter cascade (§4)', () => {
  it('a course-level override wins, and the provenance says so', () => {
    const course = fixtureCourse({ thresholdFraction: D('0.5') });
    course.batch.programme.thresholdFraction = D('0.6');
    course.batch.programme.targetAttainment = D('2.0');

    const { input, parameterResolution } = buildCourseInput(course, MARKS);
    expect(input.parameters.thresholdFraction).toBe(0.5); // course beats programme
    expect(input.parameters.targetAttainment).toBe(2.0); // programme beats institution
    expect(parameterResolution.provenance.thresholdFraction).toBe('course');
    expect(parameterResolution.provenance.targetAttainment).toBe('programme');
    expect(parameterResolution.provenance.bands).toBe('institution');
  });
});

describe('buildCourseInput — SINGLE_SCORE CO tags', () => {
  it('maps multi-CO tags ordered by course CO order', () => {
    const course = fixtureCourse();
    const endsem = course.assessments.find((a) => a.id === 'endsem')!;
    // Rows arrive in arbitrary order; the adapter orders by CO display order.
    endsem.coTags = [
      { assessmentId: 'endsem', coId: 'co2' },
      { assessmentId: 'endsem', coId: 'co1' },
    ];
    const { input } = buildCourseInput(course, MARKS);
    expect(input.assessments.find((a) => a.id === 'endsem')?.coTags).toEqual(['co1', 'co2']);
  });
});

describe('buildCourseInput — corrupt structure is an AdapterError, never a guess', () => {
  it('SINGLE_SCORE with an item count other than one', () => {
    const course = fixtureCourse();
    const endsem = course.assessments.find((a) => a.id === 'endsem')!;
    endsem.items = [
      ...endsem.items,
      { id: 'extra', assessmentId: 'endsem', sectionId: null, label: 'Extra', maxMark: D('10'), coId: null, displayOrder: 2, bloomLevel: null },
    ];
    expect(() => buildCourseInput(course, MARKS)).toThrow(AdapterError);
  });

  it('SECTIONED with an item outside any section', () => {
    const course = fixtureCourse();
    const cia1 = course.assessments.find((a) => a.id === 'cia1')!;
    cia1.items = [
      ...cia1.items,
      { id: 'stray', assessmentId: 'cia1', sectionId: null, label: 'Stray', maxMark: D('2'), coId: null, displayOrder: 3, bloomLevel: null },
    ];
    expect(() => buildCourseInput(course, MARKS)).toThrow(AdapterError);
  });

  it('ITEM_LIST with sections', () => {
    const course = fixtureCourse();
    const quiz = course.assessments.find((a) => a.id === 'quiz1')!;
    quiz.sections = [{ id: 'sX', assessmentId: 'quiz1', name: 'X', displayOrder: 1, optionalAnswerCount: null, items: [] }];
    expect(() => buildCourseInput(course, MARKS)).toThrow(AdapterError);
  });
});
