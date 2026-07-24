/**
 * Bootstrap: creates the FIRST system administrator, directly against
 * the database — the one account creation that cannot go through the
 * guarded AccountService, because no administrator exists yet to
 * authorise it. Refuses to run if any ADMIN role already exists.
 *
 *   npm run create-admin -- admin@college.example "Full Name"
 *
 * Prints the temporary password once; the account must change it at
 * first login.
 */
import { PrismaClient } from '@copo/db';
import { generateTemporaryPassword, hashPassword } from '../src/password';
import { normaliseEmail } from '../src/localProvider';

function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    /* DATABASE_URL from the environment is fine */
  }
}

async function main(): Promise<void> {
  const [email, fullName] = process.argv.slice(2);
  if (!email || !fullName) {
    console.error('Usage: npm run create-admin -- <email> "<full name>"');
    process.exitCode = 1;
    return;
  }

  loadDotEnv();
  const prisma = new PrismaClient();
  try {
    const existingAdmin = await prisma.role.findFirst({
      where: { kind: 'ADMIN', effectiveTo: null },
    });
    if (existingAdmin) {
      console.error('An active ADMIN role already exists; create further accounts through the application.');
      process.exitCode = 1;
      return;
    }

    const temporaryPassword = generateTemporaryPassword();
    const user = await prisma.user.create({
      data: {
        email: normaliseEmail(email),
        fullName,
        identityProvider: 'LOCAL',
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        isActive: true,
      },
    });
    await prisma.role.create({
      data: { userId: user.id, kind: 'ADMIN', effectiveFrom: new Date(), effectiveTo: null },
    });
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        after: { email: normaliseEmail(email), bootstrap: true },
      },
    });

    console.log(`Administrator created: ${user.id} (${normaliseEmail(email)})`);
    console.log(`Temporary password (shown once): ${temporaryPassword}`);
    console.log('The password must be changed at first login.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
