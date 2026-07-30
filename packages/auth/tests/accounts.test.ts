import { beforeEach, describe, expect, it } from 'vitest';
import {
  AccountService,
  AuthError,
  AuthService,
  AuthzDeniedError,
  Guard,
  LocalAuthProvider,
  MemoryAuditSink,
  RoleService,
  SessionService,
  hashPassword,
  relinkIdentityByEmail,
  roleEffectiveAt,
  verifyPassword,
} from '../src/index';
import type { ActorContext, ContextSource } from '../src/index';
import { FakePrisma } from './fixtures/fakePrisma';

/**
 * Account lifecycle over the in-memory database: administrator-created
 * accounts, forced first-login change, administrator reset, deactivation,
 * role effect dates, and the Google Workspace re-pointing path. The guard
 * reads roles LIVE from the same store, so authorisation reacts to grants
 * and revocations exactly as production will.
 */

class FakeDbContextSource implements ContextSource {
  constructor(private readonly db: FakePrisma) {}

  async getActor(userId: string, at: Date): Promise<ActorContext | null> {
    const user = this.db.users.find((u) => u.id === userId);
    if (!user) return null;
    return {
      userId: user.id,
      isActive: user.isActive,
      roles: this.db.rolesTable
        .filter((r) => r.userId === userId && roleEffectiveAt(r, at))
        .map(({ kind, departmentId }) => ({ kind, departmentId })),
    };
  }

  async getCourse() {
    return null;
  }
  async getProgramme() {
    return null;
  }
  async getDepartment() {
    return null;
  }
}

const NOW = new Date('2026-07-24T09:00:00Z');

let db: FakePrisma;
let audit: MemoryAuditSink;
let accounts: AccountService;
let rolesService: RoleService;
let auth: AuthService;
let sessions: SessionService;

beforeEach(async () => {
  db = new FakePrisma();
  audit = new MemoryAuditSink();
  const guard = new Guard(new FakeDbContextSource(db), audit);
  sessions = new SessionService(db.asClient());
  accounts = new AccountService(db.asClient(), guard, sessions, audit);
  rolesService = new RoleService(db.asClient(), guard, audit);
  auth = new AuthService(new LocalAuthProvider(db.asClient()), sessions, audit);

  // Bootstrapped administrator (what scripts/create-admin.ts produces).
  db.users.push({
    id: 'admin-1',
    email: 'admin@nmc.dev',
    fullName: 'System Administrator',
    identityProvider: 'LOCAL',
    passwordHash: await hashPassword('Admin-Pass-2026'),
    mustChangePassword: false,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.rolesTable.push({
    id: 'role-admin-1',
    userId: 'admin-1',
    kind: 'ADMIN',
    departmentId: null,
    effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    effectiveTo: null,
  });
});

describe('administrator-created accounts (no self-registration)', () => {
  it('creates the account with a one-time temporary password and a forced change', async () => {
    const { userId, temporaryPassword } = await accounts.createUser('admin-1', {
      email: 'Fac.One@NMC.dev',
      fullName: 'Faculty One',
    });

    const row = db.users.find((u) => u.id === userId)!;
    expect(row.email).toBe('fac.one@nmc.dev'); // normalised, and the id is not the email
    expect(userId).not.toBe(row.email);
    expect(row.identityProvider).toBe('LOCAL');
    expect(row.mustChangePassword).toBe(true);
    expect(await verifyPassword(row.passwordHash!, temporaryPassword)).toBe(true);
    expect(audit.events.some((e) => e.action === 'USER_CREATED' && e.entityId === userId)).toBe(true);
  });

  it('a non-administrator cannot create accounts, and the denial is audited', async () => {
    const { userId } = await accounts.createUser('admin-1', { email: 'fac@nmc.dev', fullName: 'Fac' });
    await expect(accounts.createUser(userId, { email: 'x@nmc.dev', fullName: 'X' })).rejects.toThrow(AuthzDeniedError);
    expect(audit.events.some((e) => e.action === 'AUTHZ_DENIED' && e.actorId === userId)).toBe(true);
  });
});

describe('login and the forced first-login change', () => {
  it('walks the full journey: temp login → forced change → old sessions dead → new password works', async () => {
    const { userId, temporaryPassword } = await accounts.createUser('admin-1', {
      email: 'fac@nmc.dev',
      fullName: 'Fac',
    });

    const wrong = await auth.loginWithPassword('fac@nmc.dev', 'not-the-password');
    expect(wrong).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
    expect(audit.events.some((e) => e.action === 'LOGIN_FAILED')).toBe(true);

    const first = await auth.loginWithPassword('fac@nmc.dev', temporaryPassword);
    if (!first.ok) expect.unreachable('temp password must log in');
    expect(first.mustChangePassword).toBe(true);

    // Policy failures leave everything intact.
    await expect(
      accounts.changePassword(userId, { currentPassword: temporaryPassword, newPassword: 'short' }),
    ).rejects.toMatchObject({ reason: 'PASSWORD_POLICY' });
    await expect(
      accounts.changePassword(userId, { currentPassword: 'wrong-current', newPassword: 'perfectly long enough' }),
    ).rejects.toMatchObject({ reason: 'INVALID_CREDENTIALS' });

    await accounts.changePassword(userId, {
      currentPassword: temporaryPassword,
      newPassword: 'a much better passphrase',
    });

    // The pre-change session is revoked — a stolen cookie dies with the change.
    await expect(sessions.validate(first.token)).rejects.toThrow(AuthError);

    const second = await auth.loginWithPassword('fac@nmc.dev', 'a much better passphrase');
    if (!second.ok) expect.unreachable('new password must log in');
    expect(second.mustChangePassword).toBe(false);

    // The temporary password is gone for good.
    expect(await auth.loginWithPassword('fac@nmc.dev', temporaryPassword)).toEqual({
      ok: false,
      reason: 'INVALID_CREDENTIALS',
    });
  });

  it('a seed placeholder hash fails cleanly instead of crashing', async () => {
    db.users.push({
      id: 'seed-user',
      email: 'seed@nmc.dev',
      fullName: 'Seed User',
      identityProvider: 'LOCAL',
      passwordHash: 'DEV-PLACEHOLDER',
      mustChangePassword: true,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await auth.loginWithPassword('seed@nmc.dev', 'DEV-PLACEHOLDER')).toEqual({
      ok: false,
      reason: 'INVALID_CREDENTIALS',
    });
  });
});

describe('administrator-initiated reset and deactivation', () => {
  it('reset issues a fresh temporary password, forces a change, and logs the user out everywhere', async () => {
    const { userId, temporaryPassword } = await accounts.createUser('admin-1', { email: 'f@nmc.dev', fullName: 'F' });
    await accounts.changePassword(userId, { currentPassword: temporaryPassword, newPassword: 'settled password 1' });
    const live = await auth.loginWithPassword('f@nmc.dev', 'settled password 1');
    if (!live.ok) expect.unreachable('login must succeed');

    const { temporaryPassword: temp2 } = await accounts.resetPassword('admin-1', userId);

    await expect(sessions.validate(live.token)).rejects.toThrow(AuthError); // logged out
    expect(await auth.loginWithPassword('f@nmc.dev', 'settled password 1')).toEqual({
      ok: false,
      reason: 'INVALID_CREDENTIALS',
    });
    const withTemp = await auth.loginWithPassword('f@nmc.dev', temp2);
    if (!withTemp.ok) expect.unreachable('reset temp must log in');
    expect(withTemp.mustChangePassword).toBe(true);
    expect(audit.events.some((e) => e.action === 'PASSWORD_RESET' && e.entityId === userId)).toBe(true);
  });

  it('only an administrator resets or deactivates', async () => {
    const { userId } = await accounts.createUser('admin-1', { email: 'f@nmc.dev', fullName: 'F' });
    await expect(accounts.resetPassword(userId, 'admin-1')).rejects.toThrow(AuthzDeniedError);
    await expect(accounts.deactivateUser(userId, 'admin-1')).rejects.toThrow(AuthzDeniedError);
  });

  it('deactivation ends sessions and blocks login without leaking which check failed on a bad password', async () => {
    const { userId, temporaryPassword } = await accounts.createUser('admin-1', { email: 'f@nmc.dev', fullName: 'F' });
    const session = await auth.loginWithPassword('f@nmc.dev', temporaryPassword);
    if (!session.ok) expect.unreachable('login must succeed');

    await accounts.deactivateUser('admin-1', userId);
    await expect(sessions.validate(session.token)).rejects.toThrow(AuthError);
    expect(await auth.loginWithPassword('f@nmc.dev', temporaryPassword)).toEqual({
      ok: false,
      reason: 'ACCOUNT_INACTIVE',
    });
    // Wrong password on an inactive account reads as plain bad credentials.
    expect(await auth.loginWithPassword('f@nmc.dev', 'wrong')).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });

    await accounts.reactivateUser('admin-1', userId);
    expect((await auth.loginWithPassword('f@nmc.dev', temporaryPassword)).ok).toBe(true);
  });
});

describe('role assignments carry effect dates (§2)', () => {
  it('grants are scope-checked; revocation closes the window without deleting history', async () => {
    const { userId } = await accounts.createUser('admin-1', { email: 'h@nmc.dev', fullName: 'H' });

    await expect(
      rolesService.grantRole('admin-1', { userId, kind: 'HOD', effectiveFrom: NOW }),
    ).rejects.toThrow(/departmentId/);
    await expect(
      rolesService.grantRole('admin-1', { userId, kind: 'FACULTY', departmentId: 'dept-math', effectiveFrom: NOW }),
    ).rejects.toThrow(/must not carry/);

    const { roleId } = await rolesService.grantRole('admin-1', {
      userId,
      kind: 'HOD',
      departmentId: 'dept-math',
      effectiveFrom: new Date('2024-06-01T00:00:00Z'),
    });

    await rolesService.revokeRole('admin-1', roleId, new Date('2025-05-31T00:00:00Z'));
    await rolesService.revokeRole('admin-1', roleId, new Date('2025-06-30T00:00:00Z')); // idempotent, keeps first close

    const row = db.rolesTable.find((r) => r.id === roleId)!;
    expect(row.effectiveTo).toEqual(new Date('2025-05-31T00:00:00Z')); // closed, not deleted

    // Who held the role when a 2024 course was computed? Still answerable.
    expect(await rolesService.effectiveRoles(userId, new Date('2024-12-01T00:00:00Z'))).toEqual([
      { kind: 'HOD', departmentId: 'dept-math' },
    ]);
    expect(await rolesService.effectiveRoles(userId, new Date('2026-01-01T00:00:00Z'))).toEqual([]);
    expect(audit.events.filter((e) => e.action === 'ROLE_GRANTED')).toHaveLength(1);
    expect(audit.events.filter((e) => e.action === 'ROLE_REVOKED')).toHaveLength(1);
  });
});

describe('Google Workspace migration path (§2.1)', () => {
  it('re-points the existing account by email: same internal id, no re-creation, audit intact', async () => {
    const { userId, temporaryPassword } = await accounts.createUser('admin-1', {
      email: 'staff@nmc.dev',
      fullName: 'Staff Member',
    });

    const { userId: relinked } = await relinkIdentityByEmail(db.asClient(), audit, {
      email: 'STAFF@nmc.dev',
      toProvider: 'GOOGLE',
      actorId: 'admin-1',
    });

    expect(relinked).toBe(userId); // the stable internal id never changes
    const row = db.users.find((u) => u.id === userId)!;
    expect(row.identityProvider).toBe('GOOGLE');
    expect(row.passwordHash).toBeNull();

    // Password login now routes the user to SSO instead of pretending the password is wrong.
    expect(await auth.loginWithPassword('staff@nmc.dev', temporaryPassword)).toEqual({
      ok: false,
      reason: 'WRONG_PROVIDER',
    });

    // The audit history references one and the same entity across its lifetime.
    const trail = audit.events.filter((e) => e.entityType === 'User' && e.entityId === userId).map((e) => e.action);
    expect(trail).toEqual(['USER_CREATED', 'IDENTITY_RELINKED']);

    // Idempotent re-point; unknown emails never create accounts.
    await expect(
      relinkIdentityByEmail(db.asClient(), audit, { email: 'staff@nmc.dev', toProvider: 'GOOGLE', actorId: null }),
    ).resolves.toEqual({ userId });
    await expect(
      relinkIdentityByEmail(db.asClient(), audit, { email: 'ghost@nmc.dev', toProvider: 'GOOGLE', actorId: null }),
    ).rejects.toThrow(/never creates accounts/);
  });
});
