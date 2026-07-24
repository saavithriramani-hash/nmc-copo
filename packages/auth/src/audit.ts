import type { PrismaClient } from '@copo/db';

/** Auth-domain audit actions (FR-17 / NFR-9). */
export type AuthAuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_CREATED'
  | 'USER_DEACTIVATED'
  | 'USER_REACTIVATED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  | 'IDENTITY_RELINKED'
  | 'AUTHZ_DENIED';

export interface AuthAuditEvent {
  action: AuthAuditAction;
  /** Who performed it; null for anonymous (e.g. a failed login). */
  actorId: string | null;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Where audit events go. Injected so services and the guard are testable
 * without a database; production wires PrismaAuditSink.
 */
export interface AuditSink {
  record(event: AuthAuditEvent): Promise<void>;
}

export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaClient) {}

  async record(event: AuthAuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        ...(event.before !== undefined ? { before: event.before as object } : {}),
        ...(event.after !== undefined ? { after: event.after as object } : {}),
      },
    });
  }
}

/** For tests and tooling: collects events in memory. */
export class MemoryAuditSink implements AuditSink {
  readonly events: AuthAuditEvent[] = [];

  async record(event: AuthAuditEvent): Promise<void> {
    this.events.push(event);
  }
}
