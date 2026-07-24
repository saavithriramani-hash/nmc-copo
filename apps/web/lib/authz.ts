import { Guard, PrismaAuditSink, PrismaContextSource } from '@copo/auth';
import { prisma } from './db';

/**
 * THE authorisation choke point for the whole app. Every server action
 * and every data-loading decision goes through guard.require /
 * guard.check — no permission logic exists in page components.
 */
export const auditSink = new PrismaAuditSink(prisma);
export const guard = new Guard(new PrismaContextSource(prisma), auditSink);
