import type { PrismaClient } from '@copo/db';
import type { AuditSink } from './audit';
import type { Guard } from './authz/guard';
import { roleEffectiveAt, type EffectiveRole } from './authz/context';

export type RoleKindValue = 'ADMIN' | 'PRINCIPAL' | 'DEAN' | 'IQAC' | 'COE' | 'HOD' | 'FACULTY';

/**
 * Role assignments carry effect dates (§2): staff change hands between
 * accreditation cycles, and the record must still show who held which
 * role when a course was computed. Therefore:
 *  - granting creates a row with effectiveFrom (past-dated allowed);
 *  - revoking CLOSES the window (sets effectiveTo) — rows are never
 *    deleted, so history remains queryable at any instant;
 *  - scope shape (HoD→department, every other role→none) is a database
 *    CHECK constraint, not just validation here.
 */
export class RoleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly guard: Guard,
    private readonly audit: AuditSink,
  ) {}

  async grantRole(
    actorId: string,
    args: {
      userId: string;
      kind: RoleKindValue;
      departmentId?: string;
      effectiveFrom: Date;
    },
  ): Promise<{ roleId: string }> {
    await this.guard.require(actorId, { type: 'users.manage' });

    // Fail with a clear message before the database CHECK would.
    if (args.kind === 'HOD' && !args.departmentId) throw new Error('HOD requires a departmentId scope');
    if (args.kind !== 'HOD' && args.departmentId) throw new Error(`${args.kind} must not carry a departmentId`);

    const role = await this.prisma.role.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        departmentId: args.departmentId ?? null,
        effectiveFrom: args.effectiveFrom,
        effectiveTo: null,
      },
    });

    await this.audit.record({
      action: 'ROLE_GRANTED',
      actorId,
      entityType: 'Role',
      entityId: role.id,
      after: {
        userId: args.userId,
        kind: args.kind,
        departmentId: args.departmentId ?? null,
        effectiveFrom: args.effectiveFrom.toISOString(),
      },
    });
    return { roleId: role.id };
  }

  /** Ends the assignment as of `effectiveTo` (default now). Never deletes. */
  async revokeRole(actorId: string, roleId: string, effectiveTo: Date = new Date()): Promise<void> {
    await this.guard.require(actorId, { type: 'users.manage' });

    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new Error(`No role assignment '${roleId}'`);
    if (role.effectiveTo !== null) return; // already closed; idempotent

    await this.prisma.role.update({ where: { id: roleId }, data: { effectiveTo } });
    await this.audit.record({
      action: 'ROLE_REVOKED',
      actorId,
      entityType: 'Role',
      entityId: roleId,
      before: { effectiveTo: null },
      after: { effectiveTo: effectiveTo.toISOString() },
    });
  }

  /**
   * The roles a user held at a given instant — `at` in the past answers
   * "who was HoD when this snapshot was locked".
   */
  async effectiveRoles(userId: string, at: Date = new Date()): Promise<EffectiveRole[]> {
    const roles = await this.prisma.role.findMany({ where: { userId } });
    return roles.filter((role) => roleEffectiveAt(role, at)).map(({ kind, departmentId }) => ({ kind, departmentId }));
  }
}
