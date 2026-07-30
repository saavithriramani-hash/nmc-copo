import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@copo/db';

/**
 * In-memory stand-in for the slice of PrismaClient the auth services
 * touch (user, session, role). Implements exactly the call shapes used —
 * anything else throws, so a service quietly widening its data access
 * fails a test instead of passing unnoticed. Uniqueness (email, token
 * hash) is enforced by the real database; flows here never rely on it.
 */

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  identityProvider: 'LOCAL' | 'GOOGLE';
  passwordHash: string | null;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
}

export interface RoleRow {
  id: string;
  userId: string;
  kind: 'ADMIN' | 'PRINCIPAL' | 'DEAN' | 'IQAC' | 'HOD' | 'FACULTY';
  departmentId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export class FakePrisma {
  users: UserRow[] = [];
  sessions: SessionRow[] = [];
  rolesTable: RoleRow[] = [];
  sessionUpdateCalls = 0;

  readonly user = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }): Promise<UserRow | null> => {
      if (where.id !== undefined) return this.users.find((u) => u.id === where.id) ?? null;
      if (where.email !== undefined) return this.users.find((u) => u.email === where.email) ?? null;
      throw new Error('fake user.findUnique: unsupported where');
    },
    create: async ({ data }: { data: Omit<UserRow, 'id' | 'createdAt' | 'updatedAt'> }): Promise<UserRow> => {
      const row: UserRow = { id: `u-${randomUUID()}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      this.users.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }): Promise<UserRow> => {
      const row = this.users.find((u) => u.id === where.id);
      if (!row) throw new Error('fake user.update: not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };

  readonly session = {
    create: async ({ data }: { data: Omit<SessionRow, 'id' | 'createdAt' | 'revokedAt'> & { ip: string | null; userAgent: string | null } }): Promise<SessionRow> => {
      const row: SessionRow = { id: `s-${randomUUID()}`, createdAt: new Date(), revokedAt: null, ...data };
      this.sessions.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }): Promise<SessionRow | null> =>
      this.sessions.find((s) => s.tokenHash === where.tokenHash) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }): Promise<SessionRow> => {
      const row = this.sessions.find((s) => s.id === where.id);
      if (!row) throw new Error('fake session.update: not found');
      this.sessionUpdateCalls += 1;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; userId?: string; revokedAt?: null };
      data: Partial<SessionRow>;
    }): Promise<{ count: number }> => {
      const matches = this.sessions.filter(
        (s) =>
          (where.id === undefined || s.id === where.id) &&
          (where.userId === undefined || s.userId === where.userId) &&
          (!('revokedAt' in where) || s.revokedAt === null),
      );
      for (const s of matches) Object.assign(s, data);
      return { count: matches.length };
    },
  };

  readonly role = {
    create: async ({ data }: { data: Omit<RoleRow, 'id'> }): Promise<RoleRow> => {
      const row: RoleRow = { id: `r-${randomUUID()}`, ...data };
      this.rolesTable.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }): Promise<RoleRow | null> =>
      this.rolesTable.find((r) => r.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<RoleRow> }): Promise<RoleRow> => {
      const row = this.rolesTable.find((r) => r.id === where.id);
      if (!row) throw new Error('fake role.update: not found');
      Object.assign(row, data);
      return row;
    },
    findMany: async ({ where }: { where: { userId: string } }): Promise<RoleRow[]> =>
      this.rolesTable.filter((r) => r.userId === where.userId),
  };

  asClient(): PrismaClient {
    return this as unknown as PrismaClient;
  }
}
