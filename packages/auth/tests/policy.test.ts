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
  PROG_PHYS,
  actor,
  admin,
  coordMath,
  course,
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

describe('policy — programme coordinator: their programme (§2)', () => {
  it('manages PO/PSOs, programme parameters and reads programme attainment — own programme only', () => {
    expect(decide(coordMath, { type: 'programme.manage', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(true);
    expect(decide(coordMath, { type: 'settings.programme.write', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(true);
    expect(decide(coordMath, { type: 'programme.read', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(true);
    expect(decide(coordMath, { type: 'programme.manage', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(false);
    expect(decide(coordMath, { type: 'programme.read', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(false);
  });

  it('edits articulation matrices and reads courses within the programme — but never raw marks (NFR-10)', () => {
    expect(decide(coordMath, courseAction('matrix.write', 'c-math-1'), C_MATH_1).allow).toBe(true);
    expect(decide(coordMath, courseAction('course.read', 'c-math-1'), C_MATH_1).allow).toBe(true);
    expect(decide(coordMath, courseAction('marks.read', 'c-math-1'), C_MATH_1)).toEqual({
      allow: false,
      reason: 'OUT_OF_SCOPE',
    });
    expect(decide(coordMath, courseAction('marks.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
    expect(decide(coordMath, courseAction('course.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });
});

describe('policy — IQAC: institution read-all plus global settings (§2)', () => {
  it('reads every course, programme, department and the institution', () => {
    expect(decide(iqac, courseAction('course.read', 'c-math-1'), C_MATH_1).allow).toBe(true);
    expect(decide(iqac, courseAction('course.read', 'c-phys-1'), C_PHYS_1).allow).toBe(true);
    expect(decide(iqac, { type: 'programme.read', programmeId: 'prog-phys' }, PROG_PHYS).allow).toBe(true);
    expect(decide(iqac, { type: 'department.read', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(iqac, { type: 'institution.read' }, null).allow).toBe(true);
    expect(decide(iqac, { type: 'audit.read' }, null).allow).toBe(true);
  });

  it('writes the institution defaults, and nothing below them', () => {
    expect(decide(iqac, { type: 'settings.institution.write' }, null).allow).toBe(true);
    expect(decide(iqac, { type: 'settings.programme.write', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(false);
    expect(decide(iqac, courseAction('course.write', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });

  it('read-all does NOT extend to raw per-student marks (NFR-10)', () => {
    expect(decide(iqac, courseAction('marks.read', 'c-math-1'), C_MATH_1).allow).toBe(false);
  });

  it('does not manage accounts', () => {
    expect(decide(iqac, { type: 'users.manage' }, null).allow).toBe(false);
  });
});

describe('policy — Principal/Dean: read-only dashboards (§2)', () => {
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
  it('the HoD creates courses and manages templates in their department only', () => {
    expect(decide(hodMath, { type: 'course.create', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(hodMath, { type: 'templates.manage', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(hodMath, { type: 'course.create', departmentId: 'dept-physics' }, DEPT_PHYS).allow).toBe(false);
    expect(decide(hodMath, { type: 'templates.manage', departmentId: 'dept-physics' }, DEPT_PHYS).allow).toBe(false);
  });

  it('faculty, coordinator, IQAC and admin do not create courses or manage templates', () => {
    for (const who of [facultyMath1, coordMath, iqac, admin, principal]) {
      expect(decide(who, { type: 'course.create', departmentId: 'dept-math' }, DEPT_MATH).allow, who.userId).toBe(false);
      expect(decide(who, { type: 'templates.manage', departmentId: 'dept-math' }, DEPT_MATH).allow, who.userId).toBe(false);
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

  it('multiple roles union: a faculty member who is also a coordinator', () => {
    const both = actor('fac-math-1', [
      { kind: 'FACULTY', departmentId: null, programmeId: null },
      { kind: 'PROGRAMME_COORDINATOR', departmentId: null, programmeId: 'prog-math' },
    ]);
    expect(decide(both, courseAction('marks.write', 'c-math-1'), C_MATH_1).allow).toBe(true); // as faculty
    expect(decide(both, { type: 'programme.manage', programmeId: 'prog-math' }, PROG_MATH).allow).toBe(true); // as coordinator
    // Union never grants what neither role has:
    expect(decide(both, courseAction('marks.read', 'c-math-2'), C_MATH_2).allow).toBe(false);
  });

  it('a missing resource always denies, never allows', () => {
    expect(decide(hodMath, courseAction('course.read', 'c-ghost'), null)).toEqual({
      allow: false,
      reason: 'RESOURCE_NOT_FOUND',
    });
  });
});
