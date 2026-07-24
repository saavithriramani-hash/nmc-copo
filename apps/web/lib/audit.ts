import { prisma } from './db';

/**
 * Setup-mutation audit trail (FR-17 / NFR-9): who changed what, when,
 * and the prior value. Called by every server action that writes.
 */
export async function logAudit(args: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: args.actorId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      ...(args.before !== undefined ? { before: args.before as object } : {}),
      ...(args.after !== undefined ? { after: args.after as object } : {}),
    },
  });
}
