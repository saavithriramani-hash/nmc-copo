import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { AuthError, SessionService, roleEffectiveAt } from '@copo/auth';
import type { EffectiveRole } from '@copo/auth';
import { prisma } from './db';

export const SESSION_COOKIE = 'copo_session';

export const sessions = new SessionService(prisma);

/**
 * An effective role plus the one thing the Guard has no use for: the
 * name of the department it is scoped to, for display.
 *
 * Structurally still an `EffectiveRole`, so everything that reads
 * `user.roles` to decide what to show keeps working. The name is
 * deliberately NOT added to `EffectiveRole` itself — that type is the
 * Guard's input, and presentation has no business in the authorisation
 * package.
 */
export interface SessionRole extends EffectiveRole {
  /** HOD only; null for the institution-wide roles. */
  departmentName: string | null;
}

export interface SessionUser {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  roles: SessionRole[];
  isAdmin: boolean;
  hodDepartmentIds: string[];
  isFaculty: boolean;
}

/**
 * Validates the session cookie and loads the user with their currently
 * effective roles. Cached per request. Returns null when not signed in.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const live = await sessions.validate(token);
    const user = await prisma.user.findUnique({
      where: { id: live.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        mustChangePassword: true,
        isActive: true,
        // The department name rides along on a query that already runs,
        // and this whole function is cache()d per request — so naming the
        // department in the header costs no extra round trip per page.
        roles: { include: { department: { select: { name: true } } } },
      },
    });
    if (!user || !user.isActive) return null;

    const now = new Date();
    const roles: SessionRole[] = user.roles
      .filter((role) => roleEffectiveAt(role, now))
      .map(({ kind, departmentId, department }) => ({
        kind,
        departmentId,
        departmentName: department?.name ?? null,
      }));

    return {
      userId: user.id,
      sessionId: live.sessionId,
      email: user.email,
      fullName: user.fullName,
      mustChangePassword: user.mustChangePassword,
      roles,
      isAdmin: roles.some((r) => r.kind === 'ADMIN'),
      hodDepartmentIds: roles.filter((r) => r.kind === 'HOD').map((r) => r.departmentId!),
      isFaculty: roles.some((r) => r.kind === 'FACULTY'),
    };
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
});

/**
 * For pages and server actions: redirects to /login when unauthenticated
 * and forces the first-login password change before anything else.
 */
export async function requireSession(options: { allowMustChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !options.allowMustChange) redirect('/change-password');
  return user;
}
