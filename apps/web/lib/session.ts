import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { AuthError, SessionService, roleEffectiveAt } from '@copo/auth';
import type { EffectiveRole } from '@copo/auth';
import { prisma } from './db';

export const SESSION_COOKIE = 'copo_session';

export const sessions = new SessionService(prisma);

export interface SessionUser {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  roles: EffectiveRole[];
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
      select: { id: true, email: true, fullName: true, mustChangePassword: true, isActive: true, roles: true },
    });
    if (!user || !user.isActive) return null;

    const now = new Date();
    const roles: EffectiveRole[] = user.roles
      .filter((role) => roleEffectiveAt(role, now))
      .map(({ kind, departmentId }) => ({ kind, departmentId }));

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
