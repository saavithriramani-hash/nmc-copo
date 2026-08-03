'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccountService, AuthError, AuthService, LocalAuthProvider } from '@copo/auth';
import { prisma } from '@/lib/db';
import { auditSink, guard } from '@/lib/authz';
import { sessionCookieSecure } from '@/lib/cookies';
import { SESSION_COOKIE, getSessionUser, requireSession, sessions } from '@/lib/session';

const authService = new AuthService(new LocalAuthProvider(prisma), sessions, auditSink);
const accounts = new AccountService(prisma, guard, sessions, auditSink);

async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Not simply NODE_ENV: a production build served over plain HTTP on
    // the campus LAN issues a cookie the browser then discards, and the
    // user is bounced back to the login screen. See lib/cookies.ts.
    secure: sessionCookieSecure(),
    path: '/',
    expires: expiresAt,
  });
}

export async function loginAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email address and password.' };

  const result = await authService.loginWithPassword(email, password);
  if (!result.ok) {
    const message =
      result.reason === 'ACCOUNT_INACTIVE'
        ? 'This account has been deactivated. Contact the system administrator.'
        : result.reason === 'WRONG_PROVIDER'
          ? 'This account signs in with the college Google account.'
          : 'Incorrect email address or password.';
    return { error: message };
  }

  await setSessionCookie(result.token, result.expiresAt);
  redirect(result.mustChangePassword ? '/change-password' : '/');
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  if (user) await authService.logout(user.sessionId, user.userId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function changePasswordAction(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const user = await requireSession({ allowMustChange: true });
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (newPassword !== confirm) return { error: 'The new passwords do not match.' };

  try {
    await accounts.changePassword(user.userId, { currentPassword, newPassword });
  } catch (err) {
    if (err instanceof AuthError) {
      return {
        error: err.reason === 'INVALID_CREDENTIALS' ? 'The current password is incorrect.' : err.message,
      };
    }
    throw err;
  }

  // changePassword revokes every session; issue a fresh one.
  const relogin = await authService.loginWithPassword(user.email, newPassword);
  if (relogin.ok) await setSessionCookie(relogin.token, relogin.expiresAt);
  redirect('/');
}
