import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@copo/db';
import { AuthError } from './errors';

/**
 * Server-side sessions (NFR-10: session timeout).
 *
 * The client holds an opaque 256-bit token; the database stores only its
 * SHA-256 hash, so a database leak leaks no usable sessions. A session
 * dies at whichever comes first: absolute expiry, idle timeout, or
 * revocation (logout, password change, deactivation).
 */

export interface SessionConfig {
  /** Absolute lifetime cap. Default 12 hours. */
  absoluteTtlMs: number;
  /** Inactivity timeout. Default 30 minutes. */
  idleTtlMs: number;
  /** lastSeenAt write throttle — avoid a write per request. Default 60 s. */
  touchIntervalMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  absoluteTtlMs: 12 * 60 * 60 * 1000,
  idleTtlMs: 30 * 60 * 1000,
  touchIntervalMs: 60 * 1000,
};

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

interface SessionRecord {
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

/**
 * Pure session liveness rule, exported for exhaustive unit testing:
 * revoked → invalid; past absolute expiry → expired; idle too long →
 * expired; otherwise live.
 */
export function evaluateSession(
  record: SessionRecord,
  now: Date,
  config: SessionConfig,
): 'LIVE' | 'REVOKED' | 'EXPIRED' | 'IDLE_TIMED_OUT' {
  if (record.revokedAt !== null) return 'REVOKED';
  if (now.getTime() >= record.expiresAt.getTime()) return 'EXPIRED';
  if (now.getTime() - record.lastSeenAt.getTime() > config.idleTtlMs) return 'IDLE_TIMED_OUT';
  return 'LIVE';
}

export interface LiveSession {
  sessionId: string;
  userId: string;
}

export class SessionService {
  private readonly config: SessionConfig;

  constructor(
    private readonly prisma: PrismaClient,
    config: Partial<SessionConfig> = {},
  ) {
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
  }

  /** Creates a session and returns the raw token — the only time it exists server-side. */
  async create(
    userId: string,
    meta: { ip?: string; userAgent?: string } = {},
    now: Date = new Date(),
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.config.absoluteTtlMs);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
        lastSeenAt: now,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
    return { token, sessionId: session.id, expiresAt };
  }

  /**
   * Validates a presented token. Throws AuthError on anything but a live
   * session; touches lastSeenAt at most once per touchIntervalMs.
   */
  async validate(token: string, now: Date = new Date()): Promise<LiveSession> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session) throw new AuthError('SESSION_INVALID', 'Unknown session');

    const state = evaluateSession(session, now, this.config);
    if (state === 'REVOKED') throw new AuthError('SESSION_INVALID', 'Session revoked');
    if (state !== 'LIVE') throw new AuthError('SESSION_EXPIRED', `Session ${state.toLowerCase()}`);

    if (now.getTime() - session.lastSeenAt.getTime() >= this.config.touchIntervalMs) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    return { sessionId: session.id, userId: session.userId };
  }

  async revoke(sessionId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  /** Logout-everywhere: password change, reset, deactivation. */
  async revokeAllForUser(userId: string, now: Date = new Date()): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count;
  }
}
