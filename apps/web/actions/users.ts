'use server';

import { revalidatePath } from 'next/cache';
import { AccountService, AuthError, RoleService } from '@copo/auth';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { auditSink, guard } from '@/lib/authz';
import { requireSession, sessions } from '@/lib/session';
import {
  deactivationWouldOrphanAdmin,
  findDuplicateRole,
  isRoleKind,
  revocationWouldOrphanAdmin,
  validateRoleGrant,
  type ActiveRoleRef,
} from '@/lib/userAdmin';

/**
 * Account and role administration (§2, §2.1, FR-17) — the ADMIN surface.
 *
 * Every method here delegates to @copo/auth's AccountService and
 * RoleService, which authorise through the Guard ('users.manage') and
 * write their own audit entries. This file adds no permission logic; it
 * validates input, prevents administrator lock-out, and turns errors
 * into something a non-specialist can act on.
 *
 * Temporary passwords are returned in the action result, never through a
 * redirect — a password in a URL would be recorded in browser history
 * and in the server's access log.
 */

const accounts = new AccountService(prisma, guard, sessions, auditSink);
const roles = new RoleService(prisma, guard, auditSink);

export interface CredentialResult {
  ok: true;
  email: string;
  fullName: string;
  temporaryPassword: string;
  note: string;
}
export type ActionResult = { error: string } | CredentialResult | { ok: true; message: string };

const ADMIN_PATH = '/admin/users';

async function activeAdminRoles(): Promise<ActiveRoleRef[]> {
  const rows = await prisma.role.findMany({
    where: { kind: 'ADMIN', effectiveTo: null, user: { isActive: true } },
    select: { id: true, userId: true, kind: true },
  });
  return rows.map((row) => ({ id: row.id, userId: row.userId, kind: row.kind }));
}

/** FR-17 note: AccountService.createUser writes the USER_CREATED entry. */
export async function createUserAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireSession();

  const email = String(formData.get('email') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  if (!email || !fullName) return { error: 'Both a full name and an email address are required.' };

  try {
    const created = await accounts.createUser(actor.userId, { email, fullName });
    revalidatePath(ADMIN_PATH);
    return {
      ok: true,
      email,
      fullName,
      temporaryPassword: created.temporaryPassword,
      note: 'Write this down now — it is shown once. Hand it over in person, not by email. The account must change it at first sign-in, and has no roles until you grant one below.',
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: `An account already exists for ${email}.` };
    }
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }
}

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireSession();
  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { error: 'No account selected.' };

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });
  if (!target) return { error: 'No such account.' };

  try {
    const { temporaryPassword } = await accounts.resetPassword(actor.userId, userId);
    revalidatePath(ADMIN_PATH);
    return {
      ok: true,
      email: target.email,
      fullName: target.fullName,
      temporaryPassword,
      note: 'Shown once. Every session for this account has been signed out, and the password must be changed at next sign-in.',
    };
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }
}

export async function setActiveAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireSession();
  const userId = String(formData.get('userId') ?? '');
  const activate = String(formData.get('activate') ?? '') === 'true';
  if (!userId) return { error: 'No account selected.' };

  if (!activate) {
    if (userId === actor.userId) {
      return { error: 'You cannot deactivate your own account. Ask another administrator to do it.' };
    }
    if (deactivationWouldOrphanAdmin({ userId, activeAdminRoles: await activeAdminRoles() })) {
      return {
        error:
          'This is the only active system administrator. Grant the ADMIN role to someone else first, or nobody will be able to manage accounts.',
      };
    }
  }

  if (activate) await accounts.reactivateUser(actor.userId, userId);
  else await accounts.deactivateUser(actor.userId, userId);

  revalidatePath(ADMIN_PATH);
  return { ok: true, message: activate ? 'Account reactivated.' : 'Account deactivated and signed out everywhere.' };
}

export async function grantRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireSession();

  const userId = String(formData.get('userId') ?? '');
  const kindRaw = String(formData.get('kind') ?? '');
  const scopeId = String(formData.get('scopeId') ?? '').trim();
  const effectiveFromRaw = String(formData.get('effectiveFrom') ?? '').trim();

  if (!userId) return { error: 'No account selected.' };
  if (!isRoleKind(kindRaw)) return { error: 'Choose a role.' };

  // One <select> carries the scope; which column it means depends on the
  // role, so it is split here rather than in the form.
  const departmentId = kindRaw === 'HOD' ? scopeId || null : null;
  const programmeId = kindRaw === 'PROGRAMME_COORDINATOR' ? scopeId || null : null;

  const problem = validateRoleGrant({ kind: kindRaw, departmentId, programmeId });
  if (problem) return { error: problem };

  const effectiveFrom = effectiveFromRaw ? new Date(effectiveFromRaw) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) return { error: 'The effective date is not a valid date.' };

  const existing = await prisma.role.findMany({
    where: { userId },
    select: { id: true, kind: true, departmentId: true, programmeId: true, effectiveTo: true },
  });
  if (findDuplicateRole(existing, { kind: kindRaw, departmentId, programmeId })) {
    return { error: 'This account already holds that role, with the same scope, in force.' };
  }

  try {
    await roles.grantRole(actor.userId, {
      userId,
      kind: kindRaw,
      ...(departmentId ? { departmentId } : {}),
      ...(programmeId ? { programmeId } : {}),
      effectiveFrom,
    });
  } catch (err) {
    if (err instanceof Error) return { error: err.message };
    throw err;
  }

  revalidatePath(ADMIN_PATH);
  return { ok: true, message: 'Role granted.' };
}

export async function revokeRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireSession();
  const roleId = String(formData.get('roleId') ?? '');
  const effectiveToRaw = String(formData.get('effectiveTo') ?? '').trim();
  if (!roleId) return { error: 'No role selected.' };

  if (revocationWouldOrphanAdmin({ revokingRoleId: roleId, activeAdminRoles: await activeAdminRoles() })) {
    return {
      error:
        'This is the only system administrator role in force. Grant ADMIN to someone else before revoking it, or nobody will be able to manage accounts.',
    };
  }

  const effectiveTo = effectiveToRaw ? new Date(effectiveToRaw) : new Date();
  if (Number.isNaN(effectiveTo.getTime())) return { error: 'The end date is not a valid date.' };

  await roles.revokeRole(actor.userId, roleId, effectiveTo);
  revalidatePath(ADMIN_PATH);
  return {
    ok: true,
    message: 'Role ended. The assignment is kept with its dates, so the record still shows who held it and when.',
  };
}
