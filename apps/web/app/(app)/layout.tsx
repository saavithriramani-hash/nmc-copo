import Link from 'next/link';
import { logoutAction } from '@/actions/auth';
import { requireSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();

  const isIqacOrPrincipal = user.roles.some((role) => role.kind === 'IQAC' || role.kind === 'PRINCIPAL');
  const nav: { href: string; label: string; show: boolean }[] = [
    { href: '/', label: 'Courses', show: true },
    { href: '/programmes', label: 'Programmes', show: true },
    { href: '/institution', label: 'Institution', show: isIqacOrPrincipal },
    { href: '/templates', label: 'Assessment templates', show: user.hodDepartmentIds.length > 0 },
    { href: '/admin/departments', label: 'Departments', show: user.isAdmin },
    { href: '/audit', label: 'Audit log', show: user.isAdmin || user.roles.some((role) => role.kind === 'IQAC') },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-300 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold">CO-PO Attainment</span>
          <nav className="flex gap-4">
            {nav
              .filter((item) => item.show)
              .map((item) => (
                <Link key={item.href} href={item.href} className="text-gray-700 hover:text-blue-700 hover:underline">
                  {item.label}
                </Link>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">
            {user.fullName} · {user.roles.map((r) => r.kind).join(', ') || 'no role'}
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
