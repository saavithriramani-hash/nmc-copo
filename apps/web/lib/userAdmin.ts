import type { RoleKindValue } from '@copo/auth';

/**
 * Pure rules for account and role administration (§2, §2.1). Kept out of
 * the server actions so every rule is unit-testable without a database,
 * in the manner of lib/setupPlans.ts and lib/roster.ts.
 *
 * Nothing here decides *permission* — that is the Guard's job alone
 * (`users.manage`). These are integrity rules that apply once the actor
 * is already authorised: role scope shape, and the two ways an
 * administrator could lock the institution out of its own system.
 */

export const ROLE_KINDS: readonly RoleKindValue[] = [
  'FACULTY',
  'HOD',
  'PROGRAMME_COORDINATOR',
  'IQAC',
  'PRINCIPAL',
  'ADMIN',
] as const;

/** The §2 role table, in the college's own words. */
export const ROLE_LABELS: Record<RoleKindValue, string> = {
  FACULTY: 'Faculty',
  HOD: 'Head of Department',
  PROGRAMME_COORDINATOR: 'Programme coordinator',
  IQAC: 'IQAC / Accreditation cell',
  PRINCIPAL: 'Principal / Dean',
  ADMIN: 'System administrator',
};

export const ROLE_CAPABILITIES: Record<RoleKindValue, string> = {
  FACULTY: 'Own courses: setup, mark entry, compute, export, submit for approval.',
  HOD: 'Own department: all faculty capability department-wide; approve and lock courses.',
  PROGRAMME_COORDINATOR: 'Own programme: PO/PSO definitions, articulation matrices, programme attainment.',
  IQAC: 'Institution: read-all, consolidation, global defaults, accreditation bundles.',
  PRINCIPAL: 'Institution: read-only dashboards.',
  ADMIN: 'Accounts, departments, rollover, backups. No access to academic data.',
};

export type ScopeKind = 'department' | 'programme' | 'none';

/**
 * Which scope a role kind must carry. Mirrors both RoleService.grantRole
 * and the database CHECK constraint — this is a third statement of the
 * same rule, positioned early enough to give a readable message.
 */
export function scopeFor(kind: RoleKindValue): ScopeKind {
  if (kind === 'HOD') return 'department';
  if (kind === 'PROGRAMME_COORDINATOR') return 'programme';
  return 'none';
}

export function isRoleKind(value: string): value is RoleKindValue {
  return (ROLE_KINDS as readonly string[]).includes(value);
}

/** Null when the grant is well-formed; otherwise the reason, for display. */
export function validateRoleGrant(args: {
  kind: RoleKindValue;
  departmentId: string | null;
  programmeId: string | null;
}): string | null {
  const scope = scopeFor(args.kind);
  const label = ROLE_LABELS[args.kind];

  if (scope === 'department') {
    if (!args.departmentId) return `${label} must be scoped to a department.`;
    if (args.programmeId) return `${label} is scoped to a department, not a programme.`;
    return null;
  }
  if (scope === 'programme') {
    if (!args.programmeId) return `${label} must be scoped to a programme.`;
    if (args.departmentId) return `${label} is scoped to a programme, not a department.`;
    return null;
  }
  if (args.departmentId || args.programmeId) {
    return `${label} applies to the whole institution and takes no department or programme.`;
  }
  return null;
}

export interface ActiveRoleRef {
  id: string;
  userId: string;
  kind: RoleKindValue;
}

/**
 * An identical role already in force. Re-granting would leave two open
 * windows for the same authority, which makes "who held this role when"
 * ambiguous — exactly what the effect dates exist to answer.
 */
export function findDuplicateRole(
  existing: { id: string; kind: RoleKindValue; departmentId: string | null; programmeId: string | null; effectiveTo: Date | null }[],
  candidate: { kind: RoleKindValue; departmentId: string | null; programmeId: string | null },
): string | null {
  const match = existing.find(
    (role) =>
      role.effectiveTo === null &&
      role.kind === candidate.kind &&
      (role.departmentId ?? null) === candidate.departmentId &&
      (role.programmeId ?? null) === candidate.programmeId,
  );
  return match ? match.id : null;
}

/**
 * Would revoking this role leave the institution with no administrator?
 *
 * `activeAdminRoles` is every open ADMIN assignment held by an active
 * user. Counting *users* rather than rows matters: one person may hold
 * two ADMIN rows, and revoking one of them must not read as "another
 * administrator remains".
 */
export function revocationWouldOrphanAdmin(args: {
  revokingRoleId: string;
  activeAdminRoles: ActiveRoleRef[];
}): boolean {
  const target = args.activeAdminRoles.find((role) => role.id === args.revokingRoleId);
  if (!target) return false; // not an active ADMIN role — cannot orphan anything
  return args.activeAdminRoles.every((role) => role.userId === target.userId);
}

/** The same question for deactivating a whole account. */
export function deactivationWouldOrphanAdmin(args: {
  userId: string;
  activeAdminRoles: ActiveRoleRef[];
}): boolean {
  const holdsAdmin = args.activeAdminRoles.some((role) => role.userId === args.userId);
  if (!holdsAdmin) return false;
  return args.activeAdminRoles.every((role) => role.userId === args.userId);
}

/** A role assignment's effect window, for the history column (§2). */
export function describeWindow(role: { effectiveFrom: Date; effectiveTo: Date | null }, now: Date = new Date()): string {
  const from = role.effectiveFrom.toISOString().slice(0, 10);
  if (role.effectiveTo === null) {
    return role.effectiveFrom > now ? `from ${from} (not yet in force)` : `since ${from}`;
  }
  return `${from} to ${role.effectiveTo.toISOString().slice(0, 10)}`;
}

export function isInForce(role: { effectiveFrom: Date; effectiveTo: Date | null }, now: Date = new Date()): boolean {
  if (role.effectiveFrom > now) return false;
  return role.effectiveTo === null || role.effectiveTo > now;
}
