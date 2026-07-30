import { describe, expect, it } from 'vitest';
import {
  ROLE_CAPABILITIES,
  ROLE_KINDS,
  ROLE_LABELS,
  deactivationWouldOrphanAdmin,
  describeWindow,
  findDuplicateRole,
  isInForce,
  isRoleKind,
  revocationWouldOrphanAdmin,
  scopeFor,
  validateRoleGrant,
  type ActiveRoleRef,
} from '../lib/userAdmin';

/**
 * Account/role administration rules (§2). Pure — no database.
 *
 * The lock-out cases matter most: this system is run by non-specialist
 * IT staff, and an administrator who revokes the last ADMIN role locks
 * the college out of its own accreditation records.
 */

describe('role scope (§2 role table, mirrored by the database CHECK)', () => {
  it('requires a department for the HoD, and no scope at all for the rest', () => {
    expect(scopeFor('HOD')).toBe('department');
    for (const kind of ['FACULTY', 'DEAN', 'IQAC', 'PRINCIPAL', 'ADMIN'] as const) {
      expect(scopeFor(kind), kind).toBe('none');
    }
  });

  it('names and describes every role kind', () => {
    for (const kind of ROLE_KINDS) {
      expect(ROLE_LABELS[kind], kind).toBeTruthy();
      expect(ROLE_CAPABILITIES[kind], kind).toBeTruthy();
    }
  });

  it('offers no programme-scoped role — the HoD covers every programme of the department', () => {
    // ScopeKind itself no longer admits 'programme', so this pins the
    // catalogue rather than the type: the coordinator is gone for good.
    expect(ROLE_KINDS).not.toContain('PROGRAMME_COORDINATOR');
    expect(ROLE_KINDS.filter((kind) => scopeFor(kind) === 'department')).toEqual(['HOD']);
  });

  it('accepts a well-formed grant of each shape', () => {
    expect(validateRoleGrant({ kind: 'HOD', departmentId: 'dept-math' })).toBeNull();
    expect(validateRoleGrant({ kind: 'DEAN', departmentId: null })).toBeNull();
    expect(validateRoleGrant({ kind: 'IQAC', departmentId: null })).toBeNull();
  });

  it('rejects a missing scope', () => {
    expect(validateRoleGrant({ kind: 'HOD', departmentId: null })).toMatch(/must be scoped/i);
  });

  it('rejects a scope on an institution-wide role', () => {
    // The fault RoleService throws on; caught here first, with a readable message.
    for (const kind of ['FACULTY', 'DEAN', 'IQAC', 'PRINCIPAL', 'ADMIN'] as const) {
      expect(validateRoleGrant({ kind, departmentId: 'dept-math' }), kind).toMatch(/whole institution/i);
    }
  });

  it('recognises exactly the six role kinds', () => {
    expect(isRoleKind('HOD')).toBe(true);
    expect(isRoleKind('DEAN')).toBe(true);
    expect(isRoleKind('PROGRAMME_COORDINATOR')).toBe(false); // removed 30 Jul 2026
    expect(isRoleKind('SUPERUSER')).toBe(false);
    expect(isRoleKind('hod')).toBe(false);
  });
});

describe('duplicate assignments', () => {
  const rows = [
    { id: 'r1', kind: 'HOD' as const, departmentId: 'dept-math', effectiveTo: null },
    { id: 'r2', kind: 'FACULTY' as const, departmentId: null, effectiveTo: new Date('2025-01-01') },
  ];

  it('finds an identical role still in force', () => {
    expect(findDuplicateRole(rows, { kind: 'HOD', departmentId: 'dept-math' })).toBe('r1');
  });

  it('allows the same role for a different scope', () => {
    expect(findDuplicateRole(rows, { kind: 'HOD', departmentId: 'dept-phys' })).toBeNull();
  });

  it('allows re-granting a role whose window has been closed', () => {
    // Re-appointment after a gap is normal; only an open duplicate is ambiguous.
    expect(findDuplicateRole(rows, { kind: 'FACULTY', departmentId: null })).toBeNull();
  });
});

describe('administrator lock-out (the case that would strand the college)', () => {
  const soleAdmin: ActiveRoleRef[] = [{ id: 'role-a', userId: 'user-a', kind: 'ADMIN' }];
  const twoAdmins: ActiveRoleRef[] = [
    { id: 'role-a', userId: 'user-a', kind: 'ADMIN' },
    { id: 'role-b', userId: 'user-b', kind: 'ADMIN' },
  ];

  it('refuses to revoke the only administrator role', () => {
    expect(revocationWouldOrphanAdmin({ revokingRoleId: 'role-a', activeAdminRoles: soleAdmin })).toBe(true);
  });

  it('permits revoking one of two administrators', () => {
    expect(revocationWouldOrphanAdmin({ revokingRoleId: 'role-a', activeAdminRoles: twoAdmins })).toBe(false);
  });

  it('counts people, not rows: two ADMIN rows held by one person are still one administrator', () => {
    const doubled: ActiveRoleRef[] = [
      { id: 'role-a', userId: 'user-a', kind: 'ADMIN' },
      { id: 'role-a2', userId: 'user-a', kind: 'ADMIN' },
    ];
    expect(revocationWouldOrphanAdmin({ revokingRoleId: 'role-a', activeAdminRoles: doubled })).toBe(true);
  });

  it('is indifferent to non-administrator roles', () => {
    expect(revocationWouldOrphanAdmin({ revokingRoleId: 'role-hod', activeAdminRoles: soleAdmin })).toBe(false);
  });

  it('refuses to deactivate the only administrator, but allows deactivating anyone else', () => {
    expect(deactivationWouldOrphanAdmin({ userId: 'user-a', activeAdminRoles: soleAdmin })).toBe(true);
    expect(deactivationWouldOrphanAdmin({ userId: 'user-a', activeAdminRoles: twoAdmins })).toBe(false);
    expect(deactivationWouldOrphanAdmin({ userId: 'user-z', activeAdminRoles: soleAdmin })).toBe(false);
  });
});

describe('effect dates (§2: the record must show who held a role when)', () => {
  const now = new Date('2026-07-27T12:00:00Z');

  it('describes an open window as "since"', () => {
    expect(describeWindow({ effectiveFrom: new Date('2025-06-01'), effectiveTo: null }, now)).toBe('since 2025-06-01');
  });

  it('describes a closed window with both dates', () => {
    expect(
      describeWindow({ effectiveFrom: new Date('2024-06-01'), effectiveTo: new Date('2025-05-31') }, now),
    ).toBe('2024-06-01 to 2025-05-31');
  });

  it('marks a future-dated assignment as not yet in force', () => {
    const future = { effectiveFrom: new Date('2027-01-01'), effectiveTo: null };
    expect(describeWindow(future, now)).toMatch(/not yet in force/);
    expect(isInForce(future, now)).toBe(false);
  });

  it('treats a window as in force on its boundaries', () => {
    // effectiveFrom in the past and effectiveTo still ahead: in force.
    expect(isInForce({ effectiveFrom: new Date('2025-01-01'), effectiveTo: new Date('2026-12-31') }, now)).toBe(true);
    // Already closed.
    expect(isInForce({ effectiveFrom: new Date('2024-01-01'), effectiveTo: new Date('2025-01-01') }, now)).toBe(false);
  });
});
