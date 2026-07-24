import type { PrismaClient } from '@copo/db';
import type { AuditSink } from './audit';
import { normaliseEmail } from './localProvider';

/**
 * The Google Workspace migration path (§2.1), implemented now so the
 * later OIDC provider needs nothing outside this package.
 *
 * An existing account is matched BY EMAIL and re-pointed to the new
 * identity provider. The internal user id — which every course,
 * snapshot, role and audit row references — never changes, so no
 * account is re-created and no audit history is lost. The local
 * password hash is cleared: after re-pointing, only the new provider
 * can authenticate this user.
 *
 * Returns the (unchanged) internal user id.
 */
export async function relinkIdentityByEmail(
  prisma: PrismaClient,
  audit: AuditSink,
  args: { email: string; toProvider: 'GOOGLE' | 'LOCAL'; actorId: string | null },
): Promise<{ userId: string }> {
  const email = normaliseEmail(args.email);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`No account exists for ${email}; identity re-pointing never creates accounts`);
  }
  if (user.identityProvider === args.toProvider) {
    return { userId: user.id }; // already pointed; idempotent
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      identityProvider: args.toProvider,
      // Local passwords are meaningless under an external provider; a
      // move back to LOCAL requires an administrator reset to set one.
      passwordHash: null,
      mustChangePassword: args.toProvider === 'LOCAL',
    },
  });

  await audit.record({
    action: 'IDENTITY_RELINKED',
    actorId: args.actorId,
    entityType: 'User',
    entityId: user.id,
    before: { identityProvider: user.identityProvider },
    after: { identityProvider: args.toProvider },
  });

  return { userId: user.id };
}
