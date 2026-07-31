import { describe, expect, it } from 'vitest';
import { excludeAssigned, matchFaculty, type FacultyOption } from '../lib/facultySearch';

/**
 * Faculty picker matching (FR-4 staffing).
 *
 * The failure that matters is silent: a Head of Department types a name,
 * nothing comes up, and they conclude the account does not exist. Every
 * case below is a way a real name could go missing.
 */

const faculty: FacultyOption[] = [
  { id: 'u1', fullName: 'Meena Sundaram', email: 'meena.s@nmc.edu' },
  { id: 'u2', fullName: 'R. Meenakshi', email: 'meenakshi.r@nmc.edu' },
  { id: 'u3', fullName: 'Anand Prakash', email: 'anand.p@physics.nmc.edu' },
  { id: 'u4', fullName: 'Ravi Kumar', email: 'ravi@nmc.edu' },
  { id: 'u5', fullName: 'S. Ravikumar', email: 's.ravikumar@nmc.edu' },
];

const ids = (rows: FacultyOption[]): string[] => rows.map((row) => row.id);

describe('matching a typed query', () => {
  it('returns everyone for an empty or whitespace query', () => {
    expect(ids(matchFaculty(faculty, ''))).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(ids(matchFaculty(faculty, '   '))).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
  });

  it('matches on the name', () => {
    expect(ids(matchFaculty(faculty, 'anand'))).toEqual(['u3']);
  });

  it('matches on the email, because staff are looked up by address too', () => {
    expect(ids(matchFaculty(faculty, 'physics'))).toEqual(['u3']);
    expect(ids(matchFaculty(faculty, 'meenakshi.r@'))).toEqual(['u2']);
  });

  it('ignores case in both the query and the data', () => {
    expect(ids(matchFaculty(faculty, 'MEENA'))).toEqual(['u1', 'u2']);
    expect(ids(matchFaculty(faculty, 'RaVi'))).toEqual(['u4', 'u5']);
  });

  it('matches inside the name, not only at the start', () => {
    // "R. Meenakshi" is stored initial-first. A prefix match would hide
    // her from anyone who typed the name they know her by.
    expect(ids(matchFaculty(faculty, 'meenakshi'))).toEqual(['u2']);
  });

  it('finds a name written as one word by either half of it', () => {
    // "Ravi Kumar" and "S. Ravikumar" are two people whose names are
    // recorded differently. Searching "kumar" must surface BOTH — the
    // HoD picks the right one by email, and neither is silently hidden.
    expect(ids(matchFaculty(faculty, 'kumar'))).toEqual(['u4', 'u5']);
    expect(ids(matchFaculty(faculty, 'ravikumar'))).toEqual(['u5']);
  });

  it('narrows with each additional term, in any order', () => {
    expect(ids(matchFaculty(faculty, 'meena'))).toEqual(['u1', 'u2']);
    expect(ids(matchFaculty(faculty, 'meena sundaram'))).toEqual(['u1']);
    // Terms may span the name AND the email, and need not be adjacent.
    expect(ids(matchFaculty(faculty, 'anand physics'))).toEqual(['u3']);
    expect(ids(matchFaculty(faculty, 'physics anand'))).toEqual(['u3']);
  });

  it('collapses repeated spaces rather than matching nothing', () => {
    expect(ids(matchFaculty(faculty, '  meena   sundaram '))).toEqual(['u1']);
  });

  it('returns nothing for a query that matches nobody', () => {
    expect(matchFaculty(faculty, 'zzz')).toEqual([]);
  });

  it('never mutates or reorders the source list', () => {
    const before = [...faculty];
    const all = matchFaculty(faculty, '');
    all.reverse();
    expect(faculty).toEqual(before);
  });
});

describe('excluding people already on the course', () => {
  it('drops those already assigned', () => {
    expect(ids(excludeAssigned(faculty, ['u1', 'u4']))).toEqual(['u2', 'u3', 'u5']);
  });

  it('returns everyone when nobody is assigned yet', () => {
    expect(ids(excludeAssigned(faculty, []))).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
  });

  it('returns nobody once every faculty member is assigned', () => {
    // The form shows an explanation instead of an empty picker.
    expect(excludeAssigned(faculty, faculty.map((f) => f.id))).toEqual([]);
  });

  it('ignores assigned ids that are not in the list', () => {
    // A course may carry an instructor whose Faculty role has since been
    // ended; they are simply not offered again.
    expect(ids(excludeAssigned(faculty, ['ghost', 'u2']))).toEqual(['u1', 'u3', 'u4', 'u5']);
  });
});

describe('the two together, as the page uses them', () => {
  it('searches only among people who could actually be added', () => {
    const assignable = excludeAssigned(faculty, ['u1']);
    expect(ids(matchFaculty(assignable, 'meena'))).toEqual(['u2']);
  });
});
