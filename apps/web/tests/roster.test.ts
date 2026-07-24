import { describe, expect, it } from 'vitest';
import { parseRosterRows, planRosterImport } from '../lib/roster';

describe('parseRosterRows — header detection', () => {
  it('matches named columns in any order and reads an optional email', () => {
    const result = parseRosterRows([
      ['Name', 'Register No', 'Email'],
      ['Anita Kumar', '24MAT001', 'anita@nmc.dev'],
      ['Bala R', '24MAT002', ''],
    ]);
    expect(result.headerDetected).toBe(true);
    expect(result.columns).toEqual({ registerNumber: 2, fullName: 1, email: 3 });
    expect(result.entries).toEqual([
      { registerNumber: '24MAT001', fullName: 'Anita Kumar', email: 'anita@nmc.dev' },
      { registerNumber: '24MAT002', fullName: 'Bala R', email: null },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('falls back to positional columns when there is no recognisable header', () => {
    const result = parseRosterRows([
      ['24MAT001', 'Anita Kumar', 'anita@nmc.dev'],
      ['24MAT002', 'Bala R'],
    ]);
    expect(result.headerDetected).toBe(false);
    expect(result.columns).toEqual({ registerNumber: 1, fullName: 2, email: 3 });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]).toEqual({ registerNumber: '24MAT002', fullName: 'Bala R', email: null });
  });
});

describe('parseRosterRows — validation (surfaced in the preview, nothing written)', () => {
  it('flags missing register numbers, missing names, duplicates and bad emails with row numbers', () => {
    const result = parseRosterRows([
      ['Register No', 'Name', 'Email'],
      ['24MAT001', 'Anita', 'anita@nmc.dev'],
      ['', 'No Reg', ''], // row 3: missing register number
      ['24MAT003', '', ''], // row 4: missing name
      ['24MAT001', 'Dup', ''], // row 5: duplicate register number
      ['24MAT004', 'Bad Email', 'not-an-email'], // row 6: bad email
    ]);
    expect(result.entries.map((entry) => entry.registerNumber)).toEqual(['24MAT001']);
    expect(result.errors).toEqual([
      { row: 3, message: 'Missing register number.' },
      { row: 4, message: 'Missing name for register number 24MAT003.' },
      { row: 5, message: 'Duplicate register number 24MAT001 within the file.' },
      { row: 6, message: '“not-an-email” is not a valid email address.' },
    ]);
  });

  it('reports an empty file', () => {
    expect(parseRosterRows([]).errors[0]?.message).toMatch(/no rows/);
  });
});

describe('planRosterImport — diff against the existing roster', () => {
  it('splits new register numbers from those already present', () => {
    const entries = [
      { registerNumber: '24MAT001', fullName: 'Anita', email: null },
      { registerNumber: '24MAT002', fullName: 'Bala', email: null },
      { registerNumber: '24MAT003', fullName: 'Chitra', email: null },
    ];
    const plan = planRosterImport(entries, ['24MAT002']);
    expect(plan.toCreate.map((entry) => entry.registerNumber)).toEqual(['24MAT001', '24MAT003']);
    expect(plan.alreadyPresent.map((entry) => entry.registerNumber)).toEqual(['24MAT002']);
  });
});
