import { describe, expect, it } from 'vitest';
import { parseMarkCell, planMarkImport } from '../lib/marks';
import type { ImportEnrolment, ImportItem } from '../lib/marks';

describe('parseMarkCell — blank ≠ zero', () => {
  it('empty is blank (did not attempt), not zero', () => {
    expect(parseMarkCell('', 5)).toEqual({ kind: 'blank' });
    expect(parseMarkCell('   ', 5)).toEqual({ kind: 'blank' });
  });
  it('zero is a real attempted mark', () => {
    expect(parseMarkCell('0', 5)).toEqual({ kind: 'value', value: 0 });
  });
  it('accepts decimals up to the maximum, flags over-max and non-numbers', () => {
    expect(parseMarkCell('3.5', 5)).toEqual({ kind: 'value', value: 3.5 });
    expect(parseMarkCell('5', 5)).toEqual({ kind: 'value', value: 5 });
    expect(parseMarkCell('5.5', 5)).toMatchObject({ kind: 'invalid', reason: 'over the maximum of 5' });
    expect(parseMarkCell('abs', 5)).toMatchObject({ kind: 'invalid', reason: 'not a number' });
    expect(parseMarkCell('-1', 5)).toMatchObject({ kind: 'invalid' });
  });
});

describe('planMarkImport — matched on register number, every change previewed', () => {
  const items: ImportItem[] = [
    { id: 'q1', label: 'Q1', maxMark: 2 },
    { id: 'q2', label: 'Q2', maxMark: 5 },
  ];
  const enrolments: ImportEnrolment[] = [
    { enrolmentId: 'e1', registerNumber: '24MAT001', studentName: 'Anita' },
    { enrolmentId: 'e2', registerNumber: '24MAT002', studentName: 'Bala' },
  ];

  it('lists old → new for every differing cell and counts unchanged ones', () => {
    // existing: e1/q1 = 2 (unchanged), e1/q2 = 3 (→4), e2/q1 = blank (→0)
    const existing = new Map<string, number | null>([
      ['e1:q1', 2],
      ['e1:q2', 3],
      ['e2:q1', null],
    ]);
    const plan = planMarkImport({
      rows: [
        ['Register No', 'Q1', 'Q2'],
        ['24MAT001', '2', '4'],
        ['24MAT002', '0', ''],
      ],
      items,
      enrolments,
      existing,
    });

    // Two no-ops: e1/q1 (2 == 2) and e2/q2 (empty stays blank).
    expect(plan.unchanged).toBe(2);
    expect(plan.changes).toEqual([
      { enrolmentId: 'e1', itemId: 'q2', registerNumber: '24MAT001', studentName: 'Anita', itemLabel: 'Q2', oldValue: 3, newValue: 4 },
      { enrolmentId: 'e2', itemId: 'q1', registerNumber: '24MAT002', studentName: 'Bala', itemLabel: 'Q1', oldValue: null, newValue: 0 },
    ]);
    expect(plan.invalid).toEqual([]);
  });

  it('an empty cell imports as blank — a change from an existing value, shown in the preview', () => {
    const plan = planMarkImport({
      rows: [
        ['Register No', 'Q1'],
        ['24MAT001', ''],
      ],
      items: [items[0]!],
      enrolments,
      existing: new Map([['e1:q1', 4]]),
    });
    expect(plan.changes).toEqual([
      { enrolmentId: 'e1', itemId: 'q1', registerNumber: '24MAT001', studentName: 'Anita', itemLabel: 'Q1', oldValue: 4, newValue: null },
    ]);
  });

  it('reports unmatched register numbers, unknown columns and missing columns', () => {
    const plan = planMarkImport({
      rows: [
        ['Register No', 'Q1', 'Q9'],
        ['24MAT001', '2', '1'],
        ['24MAT999', '2', '1'], // not enrolled
      ],
      items, // Q2 present in the assessment but not in the file
      enrolments,
      existing: new Map(),
    });
    expect(plan.unmatchedRegisterNumbers).toEqual(['24MAT999']);
    expect(plan.unknownColumns).toEqual(['Q9']);
    expect(plan.missingColumns).toEqual(['Q2']);
  });

  it('flags over-maximum cells as invalid rather than as changes', () => {
    const plan = planMarkImport({
      rows: [
        ['Register No', 'Q1'],
        ['24MAT001', '9'],
      ],
      items: [items[0]!], // max 2
      enrolments,
      existing: new Map(),
    });
    expect(plan.changes).toEqual([]);
    expect(plan.invalid).toEqual([{ registerNumber: '24MAT001', itemLabel: 'Q1', raw: '9', reason: 'over the maximum of 2' }]);
  });
});
