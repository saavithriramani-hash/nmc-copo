import type { AuditSink } from './audit';
import type { AuthOutcome, AuthProvider } from './provider';
import type { SessionService } from './sessions';

/**
 * Login/logout orchestration: provider verifies identity, sessions issue
 * the token, audit records the event. The app layer only ever talks to
 * this and to Guard — swapping in the OIDC provider later changes the
 * constructor argument, nothing else.
 */
export class AuthService {
  constructor(
    private readonly provider: AuthProvider,
    private readonly sessions: SessionService,
    private readonly audit: AuditSink,
  ) {}

  async loginWithPassword(
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<
    | { ok: true; userId: string; token: string; sessionId: string; expiresAt: Date; mustChangePassword: boolean }
    | { ok: false; reason: Extract<AuthOutcome, { ok: false }>['reason'] }
  > {
    const outcome = await this.provider.authenticate({ kind: 'password', email, password });

    if (!outcome.ok) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        actorId: null,
        entityType: 'User',
        entityId: email.trim().toLowerCase(),
        after: { reason: outcome.reason },
      });
      return { ok: false, reason: outcome.reason };
    }

    const session = await this.sessions.create(outcome.userId, meta);
    await this.audit.record({
      action: 'LOGIN_SUCCESS',
      actorId: outcome.userId,
      entityType: 'Session',
      entityId: session.sessionId,
    });
    return { ok: true, userId: outcome.userId, ...session, mustChangePassword: outcome.mustChangePassword };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record({ action: 'LOGOUT', actorId: userId, entityType: 'Session', entityId: sessionId });
  }
}
