import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  batchBlockers,
  blockMessage,
  departmentBlockers,
  deletionSummary,
  joinBlockers,
  pluralise,
  programmeBlockers,
  validateStructureName,
} from '../lib/structureAdmin';

/**
 * Rename/delete rules for the structural spine (FR-1). Pure — no database.
 *
 * The confirmed policy is refuse-and-explain: a row is deletable only
 * while nothing references it, and deleting is never a cascade over
 * courses, marks, rosters, roles or locked snapshots. These tests pin
 * that every dependency is counted as a blocker, because a missed one
 * would let an administrator delete a live accreditation record.
 */

describe('department blockers', () => {
  it('permits deletion only when nothing references it', () => {
    expect(departmentBlockers({ programmes: 0, roles: 0, templates: 0 })).toEqual([]);
  });

  it('blocks on each dependency independently', () => {
    expect(departmentBlockers({ programmes: 1, roles: 0, templates: 0 })).toHaveLength(1);
    expect(departmentBlockers({ programmes: 0, roles: 1, templates: 0 })).toHaveLength(1);
    // Assessment templates are department-owned (FR-8) and easily forgotten.
    expect(departmentBlockers({ programmes: 0, roles: 0, templates: 1 })).toHaveLength(1);
  });

  it('reports every blocker at once, so one fix does not reveal another', () => {
    const blockers = departmentBlockers({ programmes: 2, roles: 1, templates: 3 });
    expect(blockers.map((b) => b.label)).toEqual(['2 programmes', '1 role assignment', '3 assessment templates']);
  });
});

describe('programme blockers', () => {
  it('permits deletion of an empty programme', () => {
    expect(programmeBlockers({ batches: 0 })).toEqual([]);
  });

  it('blocks on batches — the only thing that can still reference a programme', () => {
    // No role is programme-scoped since the §2 revision of 30 Jul 2026,
    // so a role assignment can no longer hold a programme open.
    expect(programmeBlockers({ batches: 1 })[0]!.label).toBe('1 batch');
    expect(programmeBlockers({ batches: 3 })[0]!.label).toBe('3 batches');
  });
});

describe('batch blockers', () => {
  it('permits deletion of an empty batch', () => {
    expect(batchBlockers({ courses: 0, roster: 0 })).toEqual([]);
  });

  it('blocks on courses and on roster entries', () => {
    // A roster entry carries a register number — real student data.
    expect(batchBlockers({ courses: 0, roster: 1 })[0]!.label).toBe('1 student on the roster');
    expect(batchBlockers({ courses: 0, roster: 40 })[0]!.label).toBe('40 students on the roster');
    expect(batchBlockers({ courses: 2, roster: 0 })[0]!.label).toBe('2 courses');
  });
});

describe('pluralisation and phrasing', () => {
  it('pluralises regularly and irregularly', () => {
    expect(pluralise(1, 'programme')).toBe('1 programme');
    expect(pluralise(2, 'programme')).toBe('2 programmes');
    expect(pluralise(1, 'batch', 'batches')).toBe('1 batch');
    expect(pluralise(0, 'batch', 'batches')).toBe('0 batches');
  });

  it('joins blockers readably', () => {
    expect(joinBlockers([])).toBe('');
    expect(joinBlockers([{ label: '1 programme', count: 1 }])).toBe('1 programme');
    expect(
      joinBlockers([
        { label: '2 programmes', count: 2 },
        { label: '1 role assignment', count: 1 },
      ]),
    ).toBe('2 programmes and 1 role assignment');
    expect(
      joinBlockers([
        { label: '2 programmes', count: 2 },
        { label: '1 role assignment', count: 1 },
        { label: '3 assessment templates', count: 3 },
      ]),
    ).toBe('2 programmes, 1 role assignment and 3 assessment templates');
  });

  it('produces a refusal naming the record and every blocker', () => {
    const message = blockMessage('Physics', departmentBlockers({ programmes: 2, roles: 1, templates: 0 }));
    expect(message).toContain('Physics');
    expect(message).toContain('2 programmes');
    expect(message).toContain('1 role assignment');
    expect(message).toMatch(/Remove or reassign/);
  });

  it('agrees its verb with a single dependant', () => {
    expect(blockMessage('Physics', departmentBlockers({ programmes: 1, roles: 0, templates: 0 }))).toContain(
      'depends on it',
    );
    expect(blockMessage('Physics', departmentBlockers({ programmes: 2, roles: 0, templates: 0 }))).toContain(
      'depend on it',
    );
  });
});

describe('name validation', () => {
  it('rejects an empty or whitespace-only name', () => {
    expect(validateStructureName('')).toMatch(/required/i);
    expect(validateStructureName('   ')).toMatch(/required/i);
  });

  it('accepts a normal name and one exactly at the limit', () => {
    expect(validateStructureName('B.Sc. Mathematics')).toBeNull();
    expect(validateStructureName('x'.repeat(MAX_NAME_LENGTH))).toBeNull();
  });

  it('rejects one character over the limit', () => {
    expect(validateStructureName('x'.repeat(MAX_NAME_LENGTH + 1))).toMatch(/at most/i);
  });
});

describe('deletion confirmation text', () => {
  it('names the record and says it cannot be undone', () => {
    expect(deletionSummary('department', 'Physics')).toBe('Delete “Physics”? This cannot be undone.');
  });

  it('discloses PO/PSO definitions that go with a programme', () => {
    // The one thing removed as a side effect — so it must be stated.
    expect(deletionSummary('programme', 'B.Sc. Physics', { outcomes: 12 })).toContain('12 PO/PSO definitions');
    expect(deletionSummary('programme', 'B.Sc. Physics', { outcomes: 1 })).toContain('1 PO/PSO definition');
  });

  it('says nothing about outcomes when there are none', () => {
    expect(deletionSummary('programme', 'B.Sc. Physics', { outcomes: 0 })).not.toContain('PO/PSO');
  });
});
