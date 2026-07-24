import type { PrismaClient } from '@copo/db';
import { DUMMY_HASH_PROMISE, verifyPassword } from './password';
import type { AuthOutcome, AuthProvider, Credentials } from './provider';

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Phase-1 authentication: local accounts, argon2id-verified passwords.
 * Administrator-created only — this package exposes no self-registration
 * path anywhere.
 */
export class LocalAuthProvider implements AuthProvider {
  readonly provider = 'LOCAL' as const;

  constructor(private readonly prisma: PrismaClient) {}

  async authenticate(credentials: Credentials): Promise<AuthOutcome> {
    if (credentials.kind !== 'password') {
      return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(credentials.email) },
    });

    if (!user) {
      // Verify against a dummy hash so absent and present accounts take
      // the same time — no user enumeration via timing.
      await verifyPassword(await DUMMY_HASH_PROMISE, credentials.password);
      return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }
    if (user.identityProvider !== 'LOCAL') {
      return { ok: false, reason: 'WRONG_PROVIDER' };
    }
    if (user.passwordHash === null) {
      await verifyPassword(await DUMMY_HASH_PROMISE, credentials.password);
      return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }

    const valid = await verifyPassword(user.passwordHash, credentials.password);
    if (!valid) return { ok: false, reason: 'INVALID_CREDENTIALS' };
    if (!user.isActive) return { ok: false, reason: 'ACCOUNT_INACTIVE' };

    return { ok: true, userId: user.id, mustChangePassword: user.mustChangePassword };
  }
}
