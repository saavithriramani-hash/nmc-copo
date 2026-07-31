import { normaliseEmail as authNormaliseEmail } from '@copo/auth';
import { describe, expect, it } from 'vitest';
import {
  describeImport,
  normaliseEmail,
  parseAccountRows,
  planAccountImport,
  type AccountRow,
  type ExistingAccount,
} from '../lib/bulkAccounts';

/**
 * Bulk account import (§2.1). Nothing here writes anything — these are
 * the rules that decide what the administrator is shown BEFORE they
 * confirm, so the cases that matter are the ones where a careless import
 * would do damage: a role the file must not be able to grant, the same
 * person twice, and an address that already belongs to someone.
 */

const grid = (...rows: string[][]) => rows;

describe('email normalisation is a deliberate copy of @copo/auth’s', () => {
  it('agrees with the original for every shape that matters', () => {
    // The copy exists because this module is imported by a CLIENT
    // component, and reaching @copo/auth would pull the native argon2
    // binding into the browser bundle. Importing it HERE is fine — tests
    // run in Node — so the two can be held together.
    for (const input of ['Ravi@NMC.edu', '  spaced@nmc.edu  ', 'ALLCAPS@NMC.EDU', 'already@lower.edu', '']) {
      expect(normaliseEmail(input), input).toBe(authNormaliseEmail(input));
    }
  });

  it('is what the planner and the database agree on: lower-cased and trimmed', () => {
    // If these diverge, an import creates a second account for someone
    // who already has one, and the unique index rejects the whole batch.
    expect(normaliseEmail('  Ravi@NMC.edu ')).toBe('ravi@nmc.edu');
  });
});

describe('column detection', () => {
  it('matches a header row in any order', () => {
    const result = parseAccountRows(
      grid(['Role', 'E-mail Address', 'Full Name'], ['Faculty', 'ravi@nmc.edu', 'Ravi Kumar']),
    );
    expect(result.headerDetected).toBe(true);
    expect(result.columns).toEqual({ fullName: 3, email: 2, role: 1 });
    expect(result.rows).toEqual([{ fullName: 'Ravi Kumar', email: 'ravi@nmc.edu', grantFaculty: true, sourceRow: 2 }]);
  });

  it('falls back to positional columns when there is no header', () => {
    const result = parseAccountRows(grid(['Ravi Kumar', 'ravi@nmc.edu'], ['Meena S', 'meena@nmc.edu']));
    expect(result.headerDetected).toBe(false);
    expect(result.rows.map((r) => r.email)).toEqual(['ravi@nmc.edu', 'meena@nmc.edu']);
    // The header-less first row is data, not a discarded heading.
    expect(result.rows[0]!.sourceRow).toBe(1);
  });

  it('finds the email column by shape when the file is written email-first', () => {
    const result = parseAccountRows(grid(['ravi@nmc.edu', 'Ravi Kumar'], ['meena@nmc.edu', 'Meena S']));
    expect(result.rows).toEqual([
      { fullName: 'Ravi Kumar', email: 'ravi@nmc.edu', grantFaculty: false, sourceRow: 1 },
      { fullName: 'Meena S', email: 'meena@nmc.edu', grantFaculty: false, sourceRow: 2 },
    ]);
  });

  it('reports an empty file rather than returning silently', () => {
    expect(parseAccountRows([]).errors).toEqual([{ row: 0, message: 'The file has no rows.' }]);
  });
});

describe('the role column can only ever grant Faculty', () => {
  it('accepts the ways people write Faculty', () => {
    for (const spelling of ['Faculty', 'faculty', 'FACULTY', 'Teacher', 'Lecturer', 'Staff']) {
      const result = parseAccountRows(grid(['Name', 'Email', 'Role'], ['Ravi', 'ravi@nmc.edu', spelling]));
      expect(result.rows[0]?.grantFaculty, spelling).toBe(true);
      expect(result.errors, spelling).toEqual([]);
    }
  });

  it('REFUSES every role that carries authority over other people', () => {
    // The whole point of the restriction: a mistyped column must not be
    // able to mint an administrator or an institution-wide reader.
    for (const role of ['Admin', 'ADMIN', 'System administrator', 'Dean', 'IQAC', 'Principal', 'HoD', 'Head of Department']) {
      const result = parseAccountRows(grid(['Name', 'Email', 'Role'], ['Ravi', 'ravi@nmc.edu', role]));
      expect(result.rows, role).toEqual([]);
      expect(result.errors[0]?.message, role).toMatch(/Only Faculty can/i);
    }
  });

  it('treats a blank role as "no role", not as an error', () => {
    const result = parseAccountRows(grid(['Name', 'Email', 'Role'], ['Ravi', 'ravi@nmc.edu', '']));
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.grantFaculty).toBe(false);
  });
});

describe('row validation', () => {
  it('rejects a missing or malformed email, naming the row', () => {
    const result = parseAccountRows(
      grid(['Name', 'Email'], ['Ravi Kumar', ''], ['Meena S', 'not-an-email'], ['Anand', 'anand@nmc.edu']),
    );
    expect(result.rows.map((r) => r.email)).toEqual(['anand@nmc.edu']);
    expect(result.errors).toEqual([
      { row: 2, message: 'Missing email address for “Ravi Kumar”.' },
      { row: 3, message: '“not-an-email” is not a valid email address.' },
    ]);
  });

  it('rejects a missing name', () => {
    const result = parseAccountRows(grid(['Name', 'Email'], ['', 'ravi@nmc.edu']));
    expect(result.errors).toEqual([{ row: 2, message: 'Missing name for ravi@nmc.edu.' }]);
  });

  it('skips stray blank lines without complaining', () => {
    const result = parseAccountRows(grid(['Name', 'Email'], ['Ravi', 'ravi@nmc.edu'], ['', ''], ['Meena', 'meena@nmc.edu']));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });

  it('ignores the “#” guidance lines left in the downloaded template', () => {
    // Forgetting to delete them is the likeliest mistake with the
    // template, and it should cost nothing.
    const result = parseAccountRows(
      grid(
        ['Full name', 'Email', 'Role'],
        ['Ravi', 'ravi@nmc.edu', 'Faculty'],
        ['# Role may only say Faculty', '', ''],
        ['#  Delete these lines before importing', '', ''],
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('catches the same person twice in one file, case-insensitively', () => {
    const result = parseAccountRows(
      grid(['Name', 'Email'], ['Ravi Kumar', 'ravi@nmc.edu'], ['R Kumar', 'Ravi@NMC.edu']),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([{ row: 3, message: 'ravi@nmc.edu also appears on row 2 of this file.' }]);
  });

  it('normalises the email it will store', () => {
    const result = parseAccountRows(grid(['Name', 'Email'], ['Ravi', '  Ravi@NMC.Edu  ']));
    expect(result.rows[0]!.email).toBe('ravi@nmc.edu');
  });
});

describe('planning against the accounts that already exist', () => {
  const row = (email: string, sourceRow = 1): AccountRow => ({
    fullName: 'Someone',
    email,
    grantFaculty: false,
    sourceRow,
  });

  it('creates the new ones and skips the registered ones', () => {
    const existing: ExistingAccount[] = [{ email: 'ravi@nmc.edu', isActive: true }];
    const plan = planAccountImport([row('ravi@nmc.edu', 2), row('meena@nmc.edu', 3)], existing);
    expect(plan.toCreate.map((r) => r.email)).toEqual(['meena@nmc.edu']);
    expect(plan.skipped).toEqual([
      { row: row('ravi@nmc.edu', 2), reason: 'An account already exists for this address.' },
    ]);
  });

  it('tells the administrator to reactivate rather than reporting a bare clash', () => {
    const plan = planAccountImport([row('ravi@nmc.edu')], [{ email: 'ravi@nmc.edu', isActive: false }]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped[0]!.reason).toMatch(/reactivate it instead/i);
  });

  it('matches existing accounts case-insensitively', () => {
    const plan = planAccountImport([row('ravi@nmc.edu')], [{ email: 'RAVI@NMC.EDU', isActive: true }]);
    expect(plan.toCreate).toEqual([]);
  });

  it('is safe to re-run: a file imported once creates nothing the second time', () => {
    // The way this feature is actually used — fix three rows, run again.
    const rows = [row('ravi@nmc.edu', 2), row('meena@nmc.edu', 3)];
    const first = planAccountImport(rows, []);
    expect(first.toCreate).toHaveLength(2);

    const afterFirstRun: ExistingAccount[] = first.toCreate.map((r) => ({ email: r.email, isActive: true }));
    const second = planAccountImport(rows, afterFirstRun);
    expect(second.toCreate).toEqual([]);
    expect(second.skipped).toHaveLength(2);
  });

  it('never proposes to change an existing account', () => {
    // The imported name differs from the stored one; the plan still only
    // skips. Renaming is an identity change and is not an import's job.
    const plan = planAccountImport(
      [{ fullName: 'A Completely Different Name', email: 'ravi@nmc.edu', grantFaculty: true, sourceRow: 2 }],
      [{ email: 'ravi@nmc.edu', isActive: true }],
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
});

describe('the one-line summary', () => {
  it('reports only what is true', () => {
    const clean = planAccountImport([{ fullName: 'A', email: 'a@nmc.edu', grantFaculty: false, sourceRow: 1 }], []);
    expect(describeImport(clean, [])).toBe('1 account to create');
  });

  it('counts skips and rejections when there are any', () => {
    const plan = planAccountImport(
      [
        { fullName: 'A', email: 'a@nmc.edu', grantFaculty: false, sourceRow: 1 },
        { fullName: 'B', email: 'b@nmc.edu', grantFaculty: false, sourceRow: 2 },
        { fullName: 'C', email: 'c@nmc.edu', grantFaculty: false, sourceRow: 3 },
      ],
      [{ email: 'c@nmc.edu', isActive: true }],
    );
    expect(describeImport(plan, [{ row: 9, message: 'bad' }])).toBe(
      '2 accounts to create · 1 already registered · 1 row rejected',
    );
  });
});
