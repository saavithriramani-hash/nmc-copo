import { describe, expect, it } from 'vitest';
import { offerTargetProblem, planCourseCopy, type SourceCourseSetup } from '../lib/courseOffer';

/**
 * CR-10: offering a course to another batch (the next year's intake).
 * Pure — no database. Synthetic fixtures only.
 */

const SOURCE = { code: 'MA101', batchId: 'b-2024', programmeId: 'p-bsc-math' };
const NEXT_YEAR = { id: 'b-2025', name: '2025–2028', programmeId: 'p-bsc-math' };

describe('which batch a course may be offered to', () => {
  it('accepts another batch of the same programme that lacks the code', () => {
    expect(offerTargetProblem({ source: SOURCE, target: NEXT_YEAR, codeTaken: false })).toBeNull();
  });

  it('requires a batch to be chosen', () => {
    expect(offerTargetProblem({ source: SOURCE, target: null, codeTaken: false })).toBe('Choose a batch.');
  });

  it('refuses the course’s own batch', () => {
    const own = { ...NEXT_YEAR, id: 'b-2024', name: '2024–2027' };
    expect(offerTargetProblem({ source: SOURCE, target: own, codeTaken: true })).toMatch(/this is that course/);
  });

  it('refuses a batch of another programme — the matrix maps onto this programme’s POs', () => {
    const physics = { ...NEXT_YEAR, programmeId: 'p-bsc-phys' };
    expect(offerTargetProblem({ source: SOURCE, target: physics, codeTaken: false })).toMatch(/its own programme/);
  });

  it('refuses a batch that already has a course with this code, naming it', () => {
    expect(offerTargetProblem({ source: SOURCE, target: NEXT_YEAR, codeTaken: true })).toBe(
      '2025–2028 already has a course MA101. Open that one instead.',
    );
  });
});

/** Two COs, one sectioned test with optional answers, one single-score external. */
const SETUP: SourceCourseSetup = {
  cos: [
    // Deliberately out of order: the plan must follow displayOrder.
    { id: 'co-2', code: 'CO2', statement: 'Apply', bloomLevels: ['K3'], displayOrder: 2, matrix: [{ poId: 'po-1', strength: 2 }] },
    {
      id: 'co-1',
      code: 'CO1',
      statement: 'Recall',
      bloomLevels: ['K1', 'K2'],
      displayOrder: 1,
      matrix: [
        { poId: 'po-1', strength: 3 },
        { poId: 'pso-1', strength: 1 },
      ],
    },
  ],
  assessments: [
    {
      name: 'End semester',
      shape: 'SINGLE_SCORE',
      scoringRule: 'COHORT_BAND',
      weightGroup: 'external',
      displayOrder: 2,
      sections: [],
      items: [{ label: 'Score', maxMark: '75.00', coId: null, sectionId: null, bloomLevel: null, displayOrder: 1 }],
      coTags: [{ coId: 'co-2' }, { coId: 'co-1' }],
    },
    {
      name: 'CIA 1',
      shape: 'SECTIONED',
      scoringRule: 'RUBRIC',
      weightGroup: 'internal',
      displayOrder: 1,
      sections: [
        { id: 's-b', name: 'Section B', displayOrder: 2, optionalAnswerCount: 3 },
        { id: 's-a', name: 'Section A', displayOrder: 1, optionalAnswerCount: null },
      ],
      items: [
        { label: 'Q2', maxMark: '5.50', coId: 'co-2', sectionId: 's-b', bloomLevel: 'K3', displayOrder: 2 },
        { label: 'Q1', maxMark: '1.00', coId: 'co-1', sectionId: 's-a', bloomLevel: 'K1', displayOrder: 1 },
        { label: 'Q3', maxMark: '2.00', coId: null, sectionId: 's-b', bloomLevel: null, displayOrder: 3 },
      ],
      coTags: [],
    },
  ],
};

describe('the copied set-up', () => {
  const plan = planCourseCopy(SETUP);

  it('copies the COs in display order, with statements and Bloom levels', () => {
    expect(plan.cos.map((co) => [co.code, co.statement, co.bloomLevels])).toEqual([
      ['CO1', 'Recall', ['K1', 'K2']],
      ['CO2', 'Apply', ['K3']],
    ]);
  });

  it('copies every matrix cell against the same POs/PSOs and strengths', () => {
    expect(plan.cos[0]!.matrix).toEqual([
      { poId: 'po-1', strength: 3 },
      { poId: 'pso-1', strength: 1 },
    ]);
    expect(plan.cos[1]!.matrix).toEqual([{ poId: 'po-1', strength: 2 }]);
  });

  it('copies assessments in order with shape, scoring rule and weight group', () => {
    expect(plan.assessments.map((a) => [a.name, a.shape, a.scoringRule, a.weightGroup])).toEqual([
      ['CIA 1', 'SECTIONED', 'RUBRIC', 'internal'],
      ['End semester', 'SINGLE_SCORE', 'COHORT_BAND', 'external'],
    ]);
  });

  it('keeps each section’s optional-answer count — the maximum-mark checks depend on it', () => {
    expect(plan.assessments[0]!.sections).toEqual([
      { name: 'Section A', displayOrder: 1, optionalAnswerCount: null },
      { name: 'Section B', displayOrder: 2, optionalAnswerCount: 3 },
    ]);
  });

  it('keeps each item in its section, against its CO, with its maximum and knowledge level', () => {
    expect(plan.assessments[0]!.items).toEqual([
      { label: 'Q1', maxMark: '1.00', coIndex: 0, sectionIndex: 0, bloomLevel: 'K1', displayOrder: 1 },
      { label: 'Q2', maxMark: '5.50', coIndex: 1, sectionIndex: 1, bloomLevel: 'K3', displayOrder: 2 },
      // Untagged stays untagged — never guessed onto a CO.
      { label: 'Q3', maxMark: '2.00', coIndex: null, sectionIndex: 1, bloomLevel: null, displayOrder: 3 },
    ]);
  });

  it('keeps a single-score assessment’s CO tags', () => {
    expect(plan.assessments[1]!.coTagIndexes).toEqual([0, 1]);
    expect(plan.assessments[1]!.items).toEqual([
      { label: 'Score', maxMark: '75.00', coIndex: null, sectionIndex: null, bloomLevel: null, displayOrder: 1 },
    ]);
  });

  it('copies an empty course as an empty course', () => {
    expect(planCourseCopy({ cos: [], assessments: [] })).toEqual({ cos: [], assessments: [] });
  });

  it('refuses a source whose item points at a CO outside the course, rather than dropping the tag', () => {
    const broken = structuredClone(SETUP);
    broken.assessments[1]!.items[0]!.coId = 'co-elsewhere';
    expect(() => planCourseCopy(broken)).toThrow(/co-elsewhere/);
  });

  it('refuses a source whose item points at a section of another assessment', () => {
    const broken = structuredClone(SETUP);
    broken.assessments[1]!.items[0]!.sectionId = 's-elsewhere';
    expect(() => planCourseCopy(broken)).toThrow(/section outside its assessment/);
  });
});
