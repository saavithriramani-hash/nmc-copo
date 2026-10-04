import { NextResponse } from 'next/server';
import { generateTemporaryPassword, hashPassword, normaliseEmail } from '@copo/auth';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';

/**
 * First-run bootstrap: creates the FIRST system administrator.
 *
 * This is the one account that cannot be created through the guarded
 * admin UI, because no administrator exists yet to authorise it. It runs
 * through Next (so every workspace import resolves) rather than a separate
 * script, because the deployed image is a compiled bundle with no TypeScript
 * runtime.
 *
 * It LOCKS ITSELF the moment an active administrator exists: every later
 * call returns 409. On a fresh install where BOOTSTRAP_TOKEN is set (the
 * deploy script sets it), the token must match — so even in the brief
 * window before the first admin exists, only whoever ran the deploy can
 * create it.
 */
export async function POST(request: Request): Promise<Response> {
  const existingAdmin = await prisma.role.findFirst({ where: { kind: 'ADMIN', effectiveTo: null } });
  if (existingAdmin) {
    return NextResponse.json(
      { error: 'An administrator already exists. Create further accounts from within the application.' },
      { status: 409 },
    );
  }

  // FAIL CLOSED. An unset token used to mean "no check", which read as
  // harmless when this only ever ran on a campus machine during a
  // supervised install. It is not harmless on a VPS deployed from a
  // hosting panel: the application answers on a public address from the
  // moment it starts, nobody sets BOOTSTRAP_TOKEN unless told to, and
  // compose passes an EMPTY STRING by default — which is falsy, so the
  // check disappeared exactly where it was most needed. The first
  // stranger to find this route would have become the administrator of
  // the college's attainment system.
  //
  // Refusing is safe: ops/deploy.sh generates a token and sets it, so the
  // sanctioned path is unaffected, and anyone deploying another way is
  // told precisely what to do.
  const expectedToken = process.env.BOOTSTRAP_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      {
        error:
          'BOOTSTRAP_TOKEN is not set on the server, so the first administrator cannot be created. Set it in .env (or in your host panel environment settings), restart the application, and call this route again with an x-bootstrap-token header.',
      },
      { status: 403 },
    );
  }
  if (request.headers.get('x-bootstrap-token') !== expectedToken) {
    return NextResponse.json({ error: 'Bootstrap token missing or incorrect.' }, { status: 403 });
  }

  let body: { email?: string; fullName?: string };
  try {
    body = (await request.json()) as { email?: string; fullName?: string };
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with email and fullName.' }, { status: 400 });
  }
  const email = normaliseEmail(String(body.email ?? ''));
  const fullName = String(body.fullName ?? '').trim();
  if (!email || !fullName) {
    return NextResponse.json({ error: 'Both email and fullName are required.' }, { status: 400 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      identityProvider: 'LOCAL',
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      isActive: true,
      roles: { create: { kind: 'ADMIN', effectiveFrom: new Date(), effectiveTo: null } },
    },
  });
  await logAudit({
    actorId: user.id,
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    after: { email, bootstrap: true },
  });

  // The temporary password is shown exactly once.
  return NextResponse.json(
    { userId: user.id, email, temporaryPassword, mustChangePassword: true },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
