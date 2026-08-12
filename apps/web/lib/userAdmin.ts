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

export const ROLE_KINDS: readonly RoleKindValue[] = ['FACULTY', 'HOD', 'COE', 'DEAN', 'IQAC', 'PRINCIPAL', 'ADMIN'] as const;

/** The §2 role table, in the college's own words. */
export const ROLE_LABELS: Record<RoleKindValue, string> = {
  FACULTY: 'Faculty',
  HOD: 'Head of Department',
  COE: 'Controller of Examinations',
  DEAN: 'Dean',
  IQAC: 'IQAC / Accreditation cell',
  PRINCIPAL: 'Principal',
  ADMIN: 'System administrator',
};

export const ROLE_CAPABILITIES: Record<RoleKindValue, string> = {
  FACULTY: 'Own courses: setup, mark entry, compute, export, submit for approval.',
  HOD: 'Own department, all its programmes: all faculty capability department-wide; PO/PSO definitions and articulation matrices; approve and lock courses; the external examination of LABORATORY courses.',
  COE: 'Institution: the course catalogue (creating courses, their code, title, semester, credits and the Laboratory flag), batches, student rosters, and the external examination of theory courses — its structure and its marks. No access to internal or continuous marks.',
  DEAN: 'Institution: read-all, consolidation, accreditation bundles, and the attainment parameters (bands and weights).',
  IQAC: 'Institution, READ-ONLY: read-all, consolidation, accreditation bundles, audit log. Sets nothing.',
  PRINCIPAL: 'Institution: read-only dashboards.',
  ADMIN: 'Accounts, departments, rollover, backups. No access to academic data.',
};

/**
 * Compact forms, for the header badge only.
 *
 * The §2 labels above are the college's own words and belong on the
 * accounts screen, where there is room for them. In the header they do
 * not fit: one person may hold four roles at once — "System
 * administrator, Dean, Head of Department — Mathematics, Faculty" is a
 * line of prose sitting beside eight navigation links.
 */
export const ROLE_SHORT_LABELS: Record<RoleKindValue, string> = {
  FACULTY: 'Faculty',
  HOD: 'HoD',
  COE: 'COE',
  DEAN: 'Dean',
  IQAC: 'IQAC',
  PRINCIPAL: 'Principal',
  ADMIN: 'Admin',
};

export interface DisplayRole {
  kind: RoleKindValue;
  /** HOD only. Every other role is institution-wide (§2). */
  departmentName?: string | null;
}

/**
 * The signed-in user's roles, as short badges — "HoD Mathematics",
 * "Dean", "Admin".
 *
 * The HoD is the only scoped role, so it is the only one that can carry
 * a department, and it leads: it is the one badge that says *where* the
 * holder's authority applies, and a reader who holds several roles is
 * asking exactly that. The rest follow in the §2 table order so the list
 * is stable between renders rather than in whatever order the roles came
 * back from the database.
 *
 * Returns an empty array for an account with no role in force — real,
 * and not an error: CR-1 left the former programme coordinators in
 * exactly that state.
 */
export function describeRoles(roles: readonly DisplayRole[]): string[] {
  const rank = (role: DisplayRole) => (role.kind === 'HOD' ? -1 : ROLE_KINDS.indexOf(role.kind));

  return [...roles]
    .sort((a, b) => {
      const byKind = rank(a) - rank(b);
      if (byKind !== 0) return byKind;
      // Two headships: order by department so the badge never reshuffles.
      return (a.departmentName ?? '').localeCompare(b.departmentName ?? '');
    })
    .map((role) => {
      const label = ROLE_SHORT_LABELS[role.kind];
      // A HOD row always has a department — the schema's CHECK constraint
      // sees to that. If one ever arrives without a name, the bare label
      // is still true, which is better than rendering "HoD null".
      return role.kind === 'HOD' && role.departmentName ? `${label} ${role.departmentName}` : label;
    });
}

export type ScopeKind = 'department' | 'none';

/**
 * Which scope a role kind must carry. Mirrors both RoleService.grantRole
 * and the database CHECK constraint — this is a third statement of the
 * same rule, positioned early enough to give a readable message.
 *
 * Since the §2 revision of 30 Jul 2026 no role is programme-scoped: the
 * HoD is responsible for every programme of their department.
 */
export function scopeFor(kind: RoleKindValue): ScopeKind {
  return kind === 'HOD' ? 'department' : 'none';
}

export function isRoleKind(value: string): value is RoleKindValue {
  return (ROLE_KINDS as readonly string[]).includes(value);
}

/** Null when the grant is well-formed; otherwise the reason, for display. */
export function validateRoleGrant(args: { kind: RoleKindValue; departmentId: string | null }): string | null {
  const label = ROLE_LABELS[args.kind];

  if (scopeFor(args.kind) === 'department') {
    return args.departmentId ? null : `${label} must be scoped to a department.`;
  }
  return args.departmentId ? `${label} applies to the whole institution and takes no department.` : null;
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
  existing: { id: string; kind: RoleKindValue; departmentId: string | null; effectiveTo: Date | null }[],
  candidate: { kind: RoleKindValue; departmentId: string | null },
): string | null {
  const match = existing.find(
    (role) =>
      role.effectiveTo === null &&
      role.kind === candidate.kind &&
      (role.departmentId ?? null) === candidate.departmentId,
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
