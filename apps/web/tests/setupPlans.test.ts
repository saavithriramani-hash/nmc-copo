import { describe, expect, it } from 'vitest';
import { applyPattern, capturePattern, parsePattern } from '../lib/setupPlans';
import type { SourceAssessment, SourceCo } from '../lib/setupPlans';

/**
 * Template/clone plan logic (FR-8/FR-9), tested without a database.
 * Fixtures are synthetic; expectations are written out by hand.
 */

const cos: SourceCo[] = [
  { id: 'co-a', displayOrder: 1 },
  { id: 'co-b', displayOrder: 2 },
  { id: 'co-c', displayOrder: 3 },
];

const cia: SourceAssessment = {
  name: 'Internal Test I',
  shape: 'SECTIONED',
  scoringRule: 'RUBRIC',
  weightGroup: 'internal',
  displayOrder: 1,
  sections: [
    { id: 'sec-b', name: 'Section B', displayOrder: 2 },
    { id: 'sec-a', name: 'Section A', displayOrder: 1 }, // out of order on purpose
  ],
  items: [
    { label: 'Q3', maxMark: 5, coId: 'co-b', sectionId: 'sec-b', displayOrder: 1 },
    { label: 'Q1', maxMark: '2', coId: 'co-a', sectionId: 'sec-a', displayOrder: 1 },
    { label: 'Q2', maxMark: 2, coId: null, sectionId: 'sec-a', displayOrder: 2 },
  ],
  coTags: [],
};

const quiz: SourceAssessment = {
  name: 'Quiz',
  shape: 'ITEM_LIST',
  scoringRule: 'RUBRIC',
  weightGroup: 'continuous',
  displayOrder: 2,
  sections: [],
  items: [{ label: 'Z1', maxMark: 1, coId: 'co-c', sectionId: null, displayOrder: 1 }],
  coTags: [],
};

const endsem: SourceAssessment = {
  name: 'End-Semester',
  shape: 'SINGLE_SCORE',
  scoringRule: 'COHORT_BAND',
  weightGroup: 'external',
  displayOrder: 3,
  sections: [],
  items: [{ label: 'Score', maxMark: '75', coId: null, sectionId: null, displayOrder: 1 }],
  coTags: [{ coId: 'co-b' }, { coId: 'co-a' }],
};

describe('capturePattern — course rows → CO-slot pattern', () => {
  const pattern = capturePattern(cos, [endsem, cia, quiz]); // shuffled input order

  it('orders assessments and sections by displayOrder and converts CO ids to 1-based slots', () => {
    expect(pattern.assessments.map((a) => a.name)).toEqual(['Internal Test I', 'Quiz', 'End-Semester']);

    const capturedCia = pattern.assessments[0]!;
    expect(capturedCia.sections?.map((s) => s.name)).toEqual(['Section A', 'Section B']);
    expect(capturedCia.sections?.[0]?.items).toEqual([
      { label: 'Q1', maxMark: 2, coIndex: 1 }, // Decimal-as-string became a number
      { label: 'Q2', maxMark: 2, coIndex: null }, // untagged stays untagged
    ]);
    expect(capturedCia.sections?.[1]?.items).toEqual([{ label: 'Q3', maxMark: 5, coIndex: 2 }]);
  });

  it('captures SINGLE_SCORE as maxMark + sorted CO slots', () => {
    const capturedEndsem = pattern.assessments[2]!;
    expect(capturedEndsem.maxMark).toBe(75);
    expect(capturedEndsem.coIndexTags).toEqual([1, 2]); // sorted, from co-b/co-a order
  });

  it('round-trips through parsePattern (what the database stores is valid)', () => {
    expect(() => parsePattern(JSON.parse(JSON.stringify(pattern)))).not.toThrow();
  });
});

describe('applyPattern — pattern + target COs → create-ready plans', () => {
  const pattern = capturePattern(cos, [cia, quiz, endsem]);

  it('maps slots onto the target course’s COs by order (clone case: same CO count → no warnings)', () => {
    const target = [{ id: 'new-1' }, { id: 'new-2' }, { id: 'new-3' }];
    const { plans, warnings } = applyPattern(pattern, target);

    expect(warnings).toEqual([]);
    const ciaPlan = plans[0]!;
    expect(ciaPlan.sections[0]?.items.map((item) => item.coId)).toEqual(['new-1', null]);
    expect(ciaPlan.sections[1]?.items[0]?.coId).toBe('new-2');
    expect(plans[1]?.items[0]?.coId).toBe('new-3');
    expect(plans[2]?.singleMaxMark).toBe(75);
    expect(plans[2]?.coTagIds).toEqual(['new-1', 'new-2']);
  });

  it('a slot beyond the course’s CO count becomes untagged WITH a warning — never a silent guess', () => {
    const target = [{ id: 'only-1' }]; // course defines just one CO
    const { plans, warnings } = applyPattern(pattern, target);

    const ciaPlan = plans[0]!;
    expect(ciaPlan.sections[1]?.items[0]?.coId).toBeNull(); // slot 2 → untagged
    expect(plans[1]?.items[0]?.coId).toBeNull(); // slot 3 → untagged
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toMatch(/only 1 CO/);
  });

  it('preserves displayOrder sequences for assessments, sections and items', () => {
    const { plans } = applyPattern(pattern, [{ id: 'x' }, { id: 'y' }, { id: 'z' }]);
    expect(plans.map((plan) => plan.displayOrder)).toEqual([1, 2, 3]);
    expect(plans[0]?.sections.map((section) => section.displayOrder)).toEqual([1, 2]);
    expect(plans[0]?.sections[0]?.items.map((item) => item.displayOrder)).toEqual([1, 2]);
  });
});

describe('parsePattern — malformed patterns are rejected loudly', () => {
  it('rejects non-objects, bad shapes, and COHORT_BAND off SINGLE_SCORE', () => {
    expect(() => parsePattern(null)).toThrow(/Malformed/);
    expect(() => parsePattern({ assessments: [{ name: 'X', shape: 'PIE', scoringRule: 'RUBRIC', weightGroup: 'g' }] })).toThrow(/bad shape/);
    expect(() =>
      parsePattern({ assessments: [{ name: 'X', shape: 'ITEM_LIST', scoringRule: 'COHORT_BAND', weightGroup: 'g', items: [] }] }),
    ).toThrow(/SINGLE_SCORE only/);
  });

  it('rejects items without positive maxima', () => {
    expect(() =>
      parsePattern({
        assessments: [
          { name: 'X', shape: 'ITEM_LIST', scoringRule: 'RUBRIC', weightGroup: 'g', items: [{ label: 'Q1', maxMark: 0, coIndex: null }] },
        ],
      }),
    ).toThrow(/positive maximum/);
  });
});
