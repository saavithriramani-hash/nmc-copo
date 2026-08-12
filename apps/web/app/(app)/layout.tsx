import Link from 'next/link';
import { logoutAction } from '@/actions/auth';
import { describeRoles } from '@/lib/userAdmin';
import { requireSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();

  // Nav visibility only — the Guard, not this list, decides access. The
  // three institution-wide roles differ on the pages they reach, so they
  // are named separately rather than lumped together.
  const holds = (kind: (typeof user.roles)[number]['kind']) => user.roles.some((role) => role.kind === kind);
  const readsInstitution = holds('DEAN') || holds('IQAC') || holds('PRINCIPAL');

  // "HoD Mathematics · Dean · Admin" rather than "HOD, DEAN, ADMIN": the
  // raw enum was never meant to be read by a person, and the HoD is the
  // only role whose authority stops at a departmental boundary — so it is
  // the one a reader needs named.
  const badges = describeRoles(user.roles);

  const nav: { href: string; label: string; show: boolean }[] = [
    { href: '/', label: 'Dashboard', show: true },
    { href: '/courses', label: 'Courses', show: true },
    { href: '/programmes', label: 'Programmes', show: true },
    { href: '/institution', label: 'Institution', show: readsInstitution },
    // CR-3: the COE publishes the external examination pattern here too.
    { href: '/templates', label: 'Assessment templates', show: user.hodDepartmentIds.length > 0 || holds('COE') },
    // CR-5: departments and programmes are the examinations office's too.
    { href: '/admin/departments', label: 'Departments', show: user.isAdmin || holds('COE') },
    { href: '/admin/users', label: 'Accounts & roles', show: user.isAdmin },
    { href: '/audit', label: 'Audit log', show: user.isAdmin || holds('DEAN') || holds('IQAC') },
    { href: '/admin/health', label: 'System health', show: user.isAdmin || readsInstitution },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/*
        `flex-wrap` throughout, because the worst case is real: one person
        may hold four roles AND see all eight navigation links, and at
        1100px those collided — the badge overlapping the last link and
        its own text clipped mid-role. Wrapping to a second row costs a
        line of height on a narrow screen; truncating costs the reader the
        department this badge exists to show.
      */}
      <header className="bg-white border-b border-gray-300 px-4 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 min-w-0">
          <span className="font-semibold whitespace-nowrap">CO-PO Attainment</span>
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
            {nav
              .filter((item) => item.show)
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-gray-700 hover:text-blue-700 hover:underline whitespace-nowrap"
                >
                  {item.label}
                </Link>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 min-w-0 ml-auto">
          <span className="text-xs text-gray-600">
            <span className="font-medium text-gray-800">{user.fullName}</span>
            {badges.length > 0 ? (
              // `whitespace-nowrap` per badge: the line may wrap between
              // roles, but never inside "HoD Mathematics".
              badges.map((badge) => (
                <span key={badge} className="whitespace-nowrap">
                  {' '}
                  · {badge}
                </span>
              ))
            ) : (
              // Real, and not an error: CR-1 ended the coordinator grants
              // and left those accounts able to sign in and see nothing.
              <span className="text-amber-700 whitespace-nowrap"> · no role in force</span>
            )}
          </span>
          <form action={logoutAction}>
            <button type="submit" className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
