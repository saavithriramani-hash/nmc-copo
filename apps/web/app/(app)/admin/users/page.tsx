import { redirect } from 'next/navigation';
import { UserAdmin, type ScopeOption, type UserView } from '@/components/UserAdmin';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { describeWindow, isInForce } from '@/lib/userAdmin';

/**
 * Accounts and roles (§2, §2.1) — the system administrator's surface.
 *
 * The administrator grants every role but holds none of their powers:
 * they cannot read a course, a mark or an attainment figure (separation
 * of duties, policy.ts). This screen is therefore the only place role
 * assignments are made, and every action it offers is audit-logged.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireSession();
  if (!(await guard.check(user.userId, { type: 'users.manage' })).allow) redirect('/');

  const { q } = await searchParams;
  const search = (q ?? '').trim();

  const rows = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    include: {
      roles: {
        include: { department: { select: { name: true } }, programme: { select: { name: true } } },
        orderBy: { effectiveFrom: 'desc' },
      },
    },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    take: 200,
  });

  const now = new Date();
  const users: UserView[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    identityProvider: row.identityProvider,
    isSelf: row.id === user.userId,
    roles: row.roles.map((role) => ({
      id: role.id,
      kind: role.kind,
      scopeLabel: role.department?.name ?? role.programme?.name ?? null,
      window: describeWindow(role, now),
      inForce: isInForce(role, now),
    })),
  }));

  const [departments, programmes] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.programme.findMany({
      select: { id: true, name: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  const departmentOptions: ScopeOption[] = departments.map((d) => ({ id: d.id, label: d.name }));
  const programmeOptions: ScopeOption[] = programmes.map((p) => ({
    id: p.id,
    label: `${p.name} (${p.department.name})`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Accounts &amp; roles</h1>
        <p className="text-xs text-gray-600 max-w-3xl">
          Roles carry effect dates, because staff change hands between accreditation cycles and the file must still
          record who computed what (§2). Ending a role closes its window — assignments are never deleted, so “who was
          Head of Department when this course was locked” stays answerable. Every change here is written to the audit
          log.
        </p>
      </div>

      <form className="flex gap-2 max-w-md">
        <input
          name="q"
          defaultValue={search}
          placeholder="Search by name or email"
          className="flex-1 border border-gray-300 rounded px-2 py-1.5"
        />
        <button type="submit" className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">No accounts match “{search}”.</p>
      ) : (
        <UserAdmin users={users} departments={departmentOptions} programmes={programmeOptions} />
      )}
    </div>
  );
}
