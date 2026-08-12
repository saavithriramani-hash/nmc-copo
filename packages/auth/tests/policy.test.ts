import { describe, expect, it } from 'vitest';
import { COURSE_ACTION_TYPES, decide } from '../src/index';
import type { Action } from '../src/index';
import {
  C_MATH_1,
  C_MATH_2,
  C_MATH_LAB,
  C_PHYS_1,
  DEPT_MATH,
  DEPT_PHYS,
  PROG_MATH,
  PROG_MATH_MSC,
  PROG_PHYS,
  actor,
  admin,
  coe,
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

describe('policy — the catalogue and the register moved to the COE (CR-3)', () => {
  it('the COE creates courses, batches and rosters in EVERY department', () => {
    // Institution-wide, like the Dean: one examinations office serves the
    // whole college, so there is no department it cannot reach.
    for (const type of ['course.create', 'batches.manage', 'roster.manage'] as const) {
      for (const dept of [DEPT_MATH, DEPT_PHYS]) {
        expect(decide(coe, { type, departmentId: dept.departmentId }, dept), `${type}/${dept.departmentId}`).toEqual({
          allow: true,
          via: 'COE',
        });
      }
    }
  });

  it('the HoD no longer does — CR-3 supersedes CR-2 on batches', () => {
    // CR-2 had given the HoD batches because they owned the roster going
    // into one. Both moved together, so the reasoning survives; it now
    // points at the COE.
    for (const type of ['course.create', 'batches.manage', 'roster.manage'] as const) {
      expect(decide(hodMath, { type, departmentId: 'dept-math' }, DEPT_MATH).allow, type).toBe(false);
    }
  });

  it('nor does the administrator, who kept batches under CR-2', () => {
    expect(decide(admin, { type: 'batches.manage', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(false);
  });

  it('nobody else either — not the Dean, the IQAC, the Principal or faculty', () => {
    for (const who of [facultyMath1, dean, iqac, principal]) {
      for (const type of ['course.create', 'batches.manage', 'roster.manage'] as const) {
        expect(decide(who, { type, departmentId: 'dept-math' }, DEPT_MATH).allow, `${who.userId}/${type}`).toBe(false);
      }
    }
  });

  it('assessment templates stay with the HoD, and the COE joins them', () => {
    // FR-8 department patterns are still the HoD's; the COE publishes the
    // institution-wide external examination pattern through the same action.
    expect(decide(hodMath, { type: 'templates.manage', departmentId: 'dept-math' }, DEPT_MATH).allow).toBe(true);
    expect(decide(hodMath, { type: 'templates.manage', departmentId: 'dept-physics' }, DEPT_PHYS).allow).toBe(false);
    expect(decide(coe, { type: 'templates.manage', departmentId: 'dept-physics' }, DEPT_PHYS)).toEqual({
      allow: true,
      via: 'COE',
    });
  });

  it('the COE gains nothing institution-wide beyond its own remit', () => {
    // The point of separate actions. Had CR-3 been implemented by handing
    // the COE `departments.manage`, this would pass silently and the
    // examinations office could reorganise the college.
    for (const type of ['departments.manage', 'users.manage', 'rollover.execute', 'backups.manage', 'settings.institution.write', 'institution.read', 'audit.read'] as const) {
      expect(decide(coe, { type }, null).allow, type).toBe(false);
    }
  });

  it('an unknown department denies before any role is consulted', () => {
    // The action carries an id the caller supplies. A programme that does
    // not exist must look exactly like one that is out of reach.
    expect(decide(admin, { type: 'batches.manage', departmentId: 'dept-nope' }, null)).toEqual({
      allow: false,
      reason: 'RESOURCE_NOT_FOUND',
    });
    expect(decide(hodMath, { type: 'batches.manage', departmentId: '' }, null)).toEqual({
      allow: false,
      reason: 'RESOURCE_NOT_FOUND',
    });
  });

  it('an inactive HoD creates nothing, CR-2 notwithstanding', () => {
    const inactive = actor('hod-math', hodMath.roles, false);
    expect(decide(inactive, { type: 'batches.manage', departmentId: 'dept-math' }, DEPT_MATH)).toEqual({
      allow: false,
      reason: 'ACCOUNT_INACTIVE',
    });
  });
});

describe('policy — the external examination (CR-3)', () => {
  const theory = (type: 'assessment.external.write' | 'marks.external.write', who: typeof coe) =>
    decide(who, { type, courseId: 'c-math-1' }, C_MATH_1);
  const lab = (type: 'assessment.external.write' | 'marks.external.write', who: typeof coe) =>
    decide(who, { type, courseId: 'c-math-lab' }, C_MATH_LAB);

  it('on a THEORY paper the COE sets the paper and enters its marks', () => {
    for (const type of ['assessment.external.write', 'marks.external.write'] as const) {
      expect(theory(type, coe), type).toEqual({ allow: true, via: 'COE' });
    }
  });

  it('…and the department does not, however senior', () => {
    for (const type of ['assessment.external.write', 'marks.external.write'] as const) {
      expect(theory(type, hodMath).allow, `hod/${type}`).toBe(false);
      expect(theory(type, facultyMath1).allow, `faculty/${type}`).toBe(false);
    }
  });

  it('on a LABORATORY paper it is the other way round — the department conducts it', () => {
    for (const type of ['assessment.external.write', 'marks.external.write'] as const) {
      expect(lab(type, hodMath), `hod/${type}`).toEqual({ allow: true, via: 'HOD(laboratory course)' });
      expect(lab(type, facultyMath1), `faculty/${type}`).toEqual({
        allow: true,
        via: 'FACULTY(own laboratory course)',
      });
      expect(lab(type, coe).allow, `coe/${type}`).toBe(false);
    }
  });

  it('THE ONE THAT MATTERS: the COE cannot touch internal or continuous marks', () => {
    // The whole reason marks.write was split. If this ever passes, the
    // examinations office can rewrite a colleague's class tests — and the
    // simplest way to break it is to "tidy up" by using marks.write here.
    expect(decide(coe, { type: 'marks.write', courseId: 'c-math-1' }, C_MATH_1).allow).toBe(false);
    expect(decide(coe, { type: 'course.write', courseId: 'c-math-1' }, C_MATH_1).allow).toBe(false);
    expect(decide(coe, { type: 'matrix.write', courseId: 'c-math-1' }, C_MATH_1).allow).toBe(false);
  });

  it('the COE reads a course and its marks, because it cannot mark blind', () => {
    // NFR-10 as amended: the reach is bounded at the screens, which serve
    // one assessment at a time behind marks.external.write.
    expect(decide(coe, { type: 'course.read', courseId: 'c-math-1' }, C_MATH_1).allow).toBe(true);
    expect(decide(coe, { type: 'marks.read', courseId: 'c-math-1' }, C_MATH_1).allow).toBe(true);
  });

  it('a LOCKED course is closed to the COE — only the HoD unlocks', () => {
    const locked = course({ status: 'LOCKED' });
    for (const type of ['assessment.external.write', 'marks.external.write', 'course.details.write'] as const) {
      expect(decide(coe, { type, courseId: 'c-math-1' }, locked), type).toEqual({
        allow: false,
        reason: 'COURSE_LOCKED',
      });
    }
    for (const type of ['course.unlock', 'course.lock', 'course.submit'] as const) {
      expect(decide(coe, { type, courseId: 'c-math-1' }, locked).allow, type).toBe(false);
    }
  });

  it('a SUBMITTED theory course is still the COE’s — results arrive after teaching ends', () => {
    // Submission freezes the FACULTY out while the HoD reviews. It must
    // not freeze out the examinations office, whose marks typically
    // arrive at exactly this point.
    const submitted = course({ status: 'SUBMITTED' });
    expect(decide(coe, { type: 'marks.external.write', courseId: 'c-math-1' }, submitted).allow).toBe(true);
    expect(decide(facultyMath1, { type: 'marks.write', courseId: 'c-math-1' }, submitted).allow).toBe(false);
  });
});

describe('policy — course details are the catalogue (CR-3)', () => {
  it('only the COE writes code, title, semester and credits', () => {
    expect(decide(coe, { type: 'course.details.write', courseId: 'c-math-1' }, C_MATH_1)).toEqual({
      allow: true,
      via: 'COE',
    });
    for (const who of [facultyMath1, hodMath, dean, iqac, principal, admin]) {
      expect(decide(who, { type: 'course.details.write', courseId: 'c-math-1' }, C_MATH_1).allow, who.userId).toBe(
        false,
      );
    }
  });

  it('but the course chain still edits everything else about the course', () => {
    // Splitting the details out must not have taken the setup with it.
    for (const type of ['course.write', 'matrix.write', 'marks.write'] as const) {
      expect(decide(facultyMath1, { type, courseId: 'c-math-1' }, C_MATH_1).allow, type).toBe(true);
      expect(decide(hodMath, { type, courseId: 'c-math-1' }, C_MATH_1).allow, type).toBe(true);
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
