import { describe, expect, it } from 'vitest';
import { COURSE_ACTION_TYPES, decide } from '../src/index';
import type { Action } from '../src/index';
import {
  C_MATH_1,
  C_MATH_2,
  C_PHYS_1,
  DEPT_MATH,
  DEPT_PHYS,
  PROG_MATH,
  PROG_MATH_MSC,
  PROG_PHYS,
  actor,
  admin,
  course,
  dean,
  facultyMath1,
  hodMath,
  iqac,
  principal,
} from './fixtures/world';

const courseAction = (type: (typeof COURSE_ACTION_TYPES)[number], courseId: string): Action => ({ type, courseId });

describe('policy — faculty scope: own courses only (§2)', () => {
  it('allows the full working set on their own DRAFT course', () => {
    for (const type of ['course.read', 'course.write', 'matrix.write', 'marks.read', 'marks.write', 'course.submit'] as const) {
      expect(decide(facultyMath1, courseAction(type, 'c-math-1'), C_MATH_1).allow, type).toBe(true);
    }
  });

  it("denies EVERY course action on a colleague's course in the same department", () => {
    for (const type of COURSE_ACTION_TYPES) {
      const decision = decide(facultyMath1, courseAction(type, 'c-math-2'), C_MATH_2);
      expect(decision.allow, type).toBe(false);
    }
  });

  it("denies EVERY course action on another department's course — including reading its marks", () => {
    for (const type of COURSE_ACTION_TYPES) {
      const decision = decide(facultyMath1, courseAction(type, 'c-phys-1'), C_PHYS_1);
      expect(decision.allow, type).toBe(false);
    }
    const marks = decide(facultyMath1, courseAction('marks.read', 'c-phys-1'), C_PHYS_1);
    expect(marks).toEqual({ allow: false, reason: 'OUT_OF_SCOPE' });
  });

  it('cannot change who teaches their own course (FR-4 staffing is the HoD’s)', () => {
    // Regression: staffing once rode on course.write, which let an
    // instructor grant any faculty member in the college read/write
    // access to this course's per-student marks (NFR-10), remove a
    // colleague the HoD had posted, or strand the course by removing
    // themselves.
    expect(decide(facultyMath1, courseAction('course.staff', 'c-math-1'), C_MATH_1)).toEqual({
      allow: false,
      reason: 'OUT_OF_SCOPE',
    });
    // …while ordinary setup on the same DRAFT course stays allowed.
    expect(decide(facultyMath1, courseAction('course.write', 'c-math-1'), C_MATH_1).allow).toBe(true);
  });

  it('never locks or unlocks, even their own course', () => {
    const submitted = course({ status: 'SUBMITTED' });
    const locked = course({ status: 'LOCKED' });
    expect(decide(facultyMath1, courseAction('course.lock', 'c-math-1'), submitted).allow).toBe(false);
    expect(decide(facultyMath1, courseAction('course.unlock', 'c-math-1'), locked).allow).toBe(false);
  });

  it('is frozen out of edits once submitted, and everyone is on LOCKED', () => {
    const submitted = course({ status: 'SUBMITTED' });
    expect(decide(facultyMath1, courseAction('marks.write', 'c-math-1'), submitted)).toEqual({
      allow: false,
      reason: 'WRONG_STATUS',
    });
    const locked = course({ status: 'LOCKED' });
    for (const who of [facultyMath1, hodMath]) {
      expect(decide(who, courseAction('marks.write', 'c-math-1'), locked)).toEqual({
        allow: false,
        reason: 'COURSE_LOCKED',
      });
    }
    // Reading a locked course stays allowed.
    expect(decide(facultyMath1, courseAction('course.read', 'c-math-1'), locked).allow).toBe(true);
  });

  it('cannot touch programme, department, institution or admin surfaces', () => {
    expect(decide(facultyMath1, { type: 'programme.read', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(false);
    expect(decide(facultyMath1, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(false);
    expect(decide(facultyMath1, { type: 'institution.read' }, null).allow).toBe(false);
    expect(decide(facultyMath1, { type: 'users.manage' }, null).allow).toBe(false);
  });
});

describe('policy — HoD scope: all courses in their department (§2)', () => {
  it("has full faculty capability on any department course, including a colleague's", () => {
    for (const type of ['course.read', 'course.write', 'marks.read', 'marks.write', 'course.submit'] as const) {
      expect(decide(hodMath, courseAction(type, 'c-math-2'), C_MATH_2).allow, type).toBe(true);
    }
  });

  it('locks a SUBMITTED course and unlocks a LOCKED one — in their department only', () => {
    const submitted = course({ status: 'SUBMITTED' });
    const locked = course({ status: 'LOCKED' });
    expect(decide(hodMath, courseAction('course.lock', 'c-math-1'), submitted).allow).toBe(true);
    expect(decide(hodMath, courseAction('course.unlock', 'c-math-1'), locked).allow).toBe(true);
    // Wrong status → denied even for the HoD.
    expect(decide(hodMath, courseAction('course.lock', 'c-math-1'), C_MATH_1)).toEqual({
      allow: false,
      reason: 'WRONG_STATUS',
    });

    const submittedPhys = course({ ...C_PHYS_1, status: 'SUBMITTED' });
    expect(decide(hodMath, courseAction('course.lock', 'c-phys-1'), submittedPhys).allow).toBe(false);
  });

  it("denies EVERY course action on the other department's courses", () => {
    for (const type of COURSE_ACTION_TYPES) {
      expect(decide(hodMath, courseAction(type, 'c-phys-1'), C_PHYS_1).allow, type).toBe(false);
    }
  });

  it('assigns and removes faculty on any department course, but never on a LOCKED one', () => {
    expect(decide(hodMath, courseAction('course.staff', 'c-math-2'), C_MATH_2).allow).toBe(true);
    expect(decide(hodMath, courseAction('course.staff', 'c-math-1'), course({ status: 'SUBMITTED' })).allow).toBe(true);
    expect(decide(hodMath, courseAction('course.staff', 'c-math-1'), course({ status: 'LOCKED' }))).toEqual({
      allow: false,
      reason: 'COURSE_LOCKED',
    });
    expect(decide(hodMath, courseAction('course.staff', 'c-phys-1'), C_PHYS_1).allow).toBe(false);
  });

  it('is the ONLY role that may staff a course', () => {
    for (const who of [facultyMath1, dean, iqac, principal, admin]) {
      expect(decide(who, courseAction('course.staff', 'c-math-1'), C_MATH_1).allow).toBe(false);
    }
    expect(decide(hodMath, courseAction('course.staff', 'c-math-1'), C_MATH_1).allow).toBe(true);
  });

  it('reads own department and its programmes; not the neighbour’s', () => {
    expect(decide(hodMath, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(hodMath, { type: 'programme.read', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(true);
    expect(decide(hodMath, { type: 'department.read', departmentId: 'dept-physics' }, DEPT_PHYS).allow).toBe(false);
    expect(decide(hodMath, { type: 'programme.read', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(false);
  });

  it('writes course-level parameter overrides (minuted exceptions) in-department', () => {
    expect(decide(hodMath, courseAction('settings.course.write', 'c-math-1'), C_MATH_1).allow).toBe(true);
    expect(decide(facultyMath1, courseAction('settings.course.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });
});

describe('policy — the HoD owns EVERY programme of their department (§2, rev. 30 Jul 2026)', () => {
  it('manages PO/PSOs and programme parameters for each of them, not only one', () => {
    for (const programme of [PROG_MATH, PROG_MATH_MSC]) {
      const id = programme.programmeId;
      expect(decide(hodMath, { type: 'programme.manage', programmeId: id }, programme).allow, id).toBe(true);
      expect(decide(hodMath, { type: 'settings.programme.write', programmeId: id }, programme).allow, id).toBe(true);
      expect(decide(hodMath, { type: 'programme.read', programmeId: id }, programme).allow, id).toBe(true);
    }
  });

  it('stops at the department boundary', () => {
    expect(decide(hodMath, { type: 'programme.manage', programmeId: 'prog-phys' }, PROG_PHYS)).toEqual({
      allow: false,
      reason: 'OUT_OF_SCOPE',
    });
    expect(decide(hodMath, { type: 'settings.programme.write', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(false);
  });

  it('no other role manages a programme — there is no coordinator to fall back on', () => {
    for (const who of [facultyMath1, dean, iqac, principal, admin]) {
      expect(decide(who, { type: 'programme.manage', programmeId: 'prog-math' }, PROG_MATH).allow, who.userId).toBe(false);
      expect(
        decide(who, { type: 'settings.programme.write', programmeId: 'prog-math' }, PROG_MATH).allow,
        who.userId,
      ).toBe(false);
    }
  });
});

describe('policy — Dean: institution read-all plus the global settings (§2, rev. 30 Jul 2026)', () => {
  it('reads every course, programme, department and the institution', () => {
    expect(decide(dean, courseAction('course.read', 'c-math-1'), C_MATH_1).allow).toBe(true);
    expect(decide(dean, courseAction('course.read', 'c-phys-1'), C_PHYS_1).allow).toBe(true);
    expect(decide(dean, { type: 'programme.read', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(true);
    expect(decide(dean, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(dean, { type: 'institution.read' }, null).allow).toBe(true);
    expect(decide(dean, { type: 'audit.read' }, null).allow).toBe(true);
  });

  it('is the ONLY role that writes the institution attainment parameters (§4.2–§4.4)', () => {
    expect(decide(dean, { type: 'settings.institution.write' }, null).allow).toBe(true);
    for (const who of [iqac, principal, admin, hodMath, facultyMath1]) {
      expect(decide(who, { type: 'settings.institution.write' }, null).allow, who.userId).toBe(false);
    }
  });

  it('writes nothing below the institution', () => {
    expect(decide(dean, { type: 'settings.programme.write', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(false);
    expect(decide(dean, courseAction('course.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
    expect(decide(dean, courseAction('settings.course.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });

  it('read-all does NOT extend to raw per-student marks (NFR-10)', () => {
    expect(decide(dean, courseAction('marks.read', 'c-math-1'), C_MATH_1)).toEqual({
      allow: false,
      reason: 'OUT_OF_SCOPE',
    });
    expect(decide(dean, courseAction('marks.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });

  it('does not manage accounts', () => {
    expect(decide(dean, { type: 'users.manage' }, null).allow).toBe(false);
  });
});

describe('policy — IQAC: read-only (§2, rev. 30 Jul 2026)', () => {
  it('keeps the whole read surface: courses, programmes, departments, institution, audit log', () => {
    expect(decide(iqac, courseAction('course.read', 'c-math-1'), C_MATH_1).allow).toBe(true);
    expect(decide(iqac, courseAction('course.read', 'c-phys-1'), C_PHYS_1).allow).toBe(true);
    expect(decide(iqac, { type: 'programme.read', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(true);
    expect(decide(iqac, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(iqac, { type: 'institution.read' }, null).allow).toBe(true);
    expect(decide(iqac, { type: 'audit.read' }, null).allow).toBe(true);
  });

  it('writes NOTHING — every write action in the catalogue is denied', () => {
    expect(decide(iqac, { type: 'settings.institution.write' }, null)).toEqual({
      allow: false,
      reason: 'NOT_PERMITTED',
    });
    expect(decide(iqac, { type: 'settings.programme.write', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(false);
    expect(decide(iqac, { type: 'programme.manage', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(false);
    for (const type of ['users.manage', 'departments.manage', 'rollover.execute', 'backups.manage'] as const) {
      expect(decide(iqac, { type }, null).allow, type).toBe(false);
    }
    for (const type of COURSE_ACTION_TYPES) {
      if (type === 'course.read') continue; // the one course action it keeps
      expect(decide(iqac, courseAction(type, 'c-math-1'), C_MATH_1).allow, type).toBe(false);
    }
  });

  it('read-all does NOT extend to raw per-student marks (NFR-10)', () => {
    expect(decide(iqac, courseAction('marks.read', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });

  it('still reaches the consolidations and accreditation bundles it is responsible for', () => {
    // FR-21/FR-22 guard on institution.read, so read-only costs the IQAC
    // none of its own work.
    expect(decide(iqac, { type: 'institution.read' }, null).allow).toBe(true);
  });
});

describe('policy — Principal: read-only dashboards (§2)', () => {
  it('reads consolidations at every level', () => {
    expect(decide(principal, { type: 'institution.read' }, null).allow).toBe(true);
    expect(decide(principal, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(principal, { type: 'programme.read', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(true);
  });

  it('reads nothing course-level and writes nothing at all', () => {
    expect(decide(principal, courseAction('course.read', 'c-math-1'), C_MATH_1).allow).toBe(false);
    expect(decide(principal, courseAction('marks.read', 'c-math-1'), C_MATH_1).allow).toBe(false);
    expect(decide(principal, { type: 'settings.institution.write' }, null).allow).toBe(false);
    expect(decide(principal, { type: 'users.manage' }, null).allow).toBe(false);
  });
});

describe('policy — system administrator: accounts and infrastructure, never academic data (§2, NFR-10)', () => {
  it('manages accounts, departments, rollover, backups and reads the audit log', () => {
    for (const type of ['users.manage', 'departments.manage', 'rollover.execute', 'backups.manage', 'audit.read'] as const) {
      expect(decide(admin, { type }, null).allow, type).toBe(true);
    }
  });

  it('holds no access to courses, marks or attainment settings', () => {
    expect(decide(admin, courseAction('course.read', 'c-math-1'), C_MATH_1).allow).toBe(false);
    expect(decide(admin, courseAction('marks.read', 'c-math-1'), C_MATH_1).allow).toBe(false);
    expect(decide(admin, { type: 'institution.read' }, null).allow).toBe(false);
    expect(decide(admin, { type: 'settings.institution.write' }, null).allow).toBe(false);
  });
});

describe('policy — course creation and assessment templates (department chain)', () => {
  it('the HoD creates courses, manages templates and imports rosters in their department only', () => {
    for (const type of ['course.create', 'templates.manage', 'roster.manage'] as const) {
      expect(decide(hodMath, { type, departmentId: 'dept-math' }, DEPT_MATH).allow, type).toBe(true);
      expect(decide(hodMath, { type, departmentId: 'dept-physics' }, DEPT_PHYS).allow, type).toBe(false);
    }
  });

  it('faculty, Dean, IQAC, admin and Principal do not create courses, manage templates or import rosters', () => {
    for (const who of [facultyMath1, dean, iqac, admin, principal]) {
      for (const type of ['course.create', 'templates.manage', 'roster.manage'] as const) {
        expect(decide(who, { type, departmentId: 'dept-math' }, DEPT_MATH).allow, `${who.userId}/${type}`).toBe(false);
      }
    }
  });
});

describe('policy — cross-cutting', () => {
  it('an inactive account is denied everything, whatever its roles', () => {
    const inactiveHod = actor('hod-math', hodMath.roles, false);
    expect(decide(inactiveHod, courseAction('course.read', 'c-math-1'), C_MATH_1)).toEqual({
      allow: false,
      reason: 'ACCOUNT_INACTIVE',
    });
    expect(decide(inactiveHod, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(false);
  });

  it('no effective role → denied (deny-by-default)', () => {
    const nobody = actor('user-x', []);
    expect(decide(nobody, courseAction('course.read', 'c-math-1'), C_MATH_1)).toEqual({
      allow: false,
      reason: 'NO_EFFECTIVE_ROLE',
    });
  });

  it('multiple roles union: a faculty member who also heads another department', () => {
    const both = actor('fac-math-1', [
      { kind: 'FACULTY', departmentId: null },
      { kind: 'HOD', departmentId: 'dept-physics' },
    ]);
    expect(decide(both, courseAction('marks.write', 'c-math-1'), C_MATH_1).allow).toBe(true); // as faculty
    expect(decide(both, { type: 'programme.manage', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(true); // as HoD
    // Union never grants what neither role has: a maths colleague's course
    // is outside the faculty scope AND outside the physics headship.
    expect(decide(both, courseAction('marks.read', 'c-math-2'), C_MATH_2).allow).toBe(false);
    expect(decide(both, { type: 'programme.manage', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(false);
  });

  it('the Dean and the IQAC differ by exactly one action: settings.institution.write', () => {
    // Pinning the split, so a later edit cannot quietly hand the IQAC a
    // write back or strip the Dean of a read.
    const institutionActions = [
      { type: 'institution.read' },
      { type: 'audit.read' },
      { type: 'users.manage' },
      { type: 'departments.manage' },
      { type: 'rollover.execute' },
      { type: 'backups.manage' },
    ] as const;
    for (const action of institutionActions) {
      expect(decide(dean, action, null).allow, action.type).toBe(decide(iqac, action, null).allow);
    }
    expect(decide(dean, { type: 'settings.institution.write' }, null).allow).toBe(true);
    expect(decide(iqac, { type: 'settings.institution.write' }, null).allow).toBe(false);
  });

  it('a missing resource always denies, never allows', () => {
    expect(decide(hodMath, courseAction('course.read', 'c-ghost'), null)).toEqual({
      allow: false,
      reason: 'RESOURCE_NOT_FOUND',
    });
  });
});
