import { notFound } from 'next/navigation';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * The audit log (FR-17 / NFR-9): who changed what, when, and the prior
 * value. Readable by the administrator, the Dean and the IQAC.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; entityId?: string; action?: string; page?: string }>;
}) {
  const user = await requireSession();
  if (!(await guard.check(user.userId, { type: 'audit.read' })).allow) notFound();

  const { entityType, entityId, action, page } = await searchParams;
  const pageNumber = Math.max(1, Number(page ?? '1') || 1);
  const pageSize = 100;

  const where = {
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(action ? { action } : {}),
  };

  const [events, total, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      skip: (pageNumber - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { fullName: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Audit log</h1>
      <p className="text-xs text-gray-600">
        {total} event(s){entityType || entityId || action ? ' matching the filter' : ''}. Every setup change, workflow
        transition, login and permission denial is recorded with its prior value.
      </p>

      <form className="flex flex-wrap items-end gap-2 bg-white border border-gray-300 rounded p-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Action</span>
          <select name="action" defaultValue={action ?? ''} className="border border-gray-300 rounded px-2 py-1.5 min-w-56">
            <option value="">All actions</option>
            {actions.map((row) => (
              <option key={row.action} value={row.action}>
                {row.action} ({row._count._all})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Entity type</span>
          <input name="entityType" defaultValue={entityType ?? ''} placeholder="Course, User, …" className="border border-gray-300 rounded px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Entity id</span>
          <input name="entityId" defaultValue={entityId ?? ''} className="border border-gray-300 rounded px-2 py-1.5 font-mono" />
        </label>
        <button type="submit" className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100">Filter</button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full bg-white border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1 w-44">When</th>
              <th className="border border-gray-300 px-2 py-1 w-48">Who</th>
              <th className="border border-gray-300 px-2 py-1 w-56">Action</th>
              <th className="border border-gray-300 px-2 py-1">Entity</th>
              <th className="border border-gray-300 px-2 py-1">Before → after</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={String(event.id)} className="align-top">
                <td className="border border-gray-300 px-2 py-1 whitespace-nowrap">{event.at.toLocaleString()}</td>
                <td className="border border-gray-300 px-2 py-1">{event.actor?.fullName ?? <span className="text-gray-500">system / anonymous</span>}</td>
                <td className="border border-gray-300 px-2 py-1 font-medium">{event.action}</td>
                <td className="border border-gray-300 px-2 py-1">
                  {event.entityType}
                  <div className="text-xs text-gray-500 font-mono">{event.entityId}</div>
                </td>
                <td className="border border-gray-300 px-2 py-1">
                  {event.before !== null || event.after !== null ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-blue-700">values</summary>
                      <div className="mt-1 space-y-1">
                        {event.before !== null ? (
                          <pre className="text-xs bg-red-50 border border-red-200 rounded p-1 overflow-x-auto max-w-xl">
                            before: {JSON.stringify(event.before, null, 1)}
                          </pre>
                        ) : null}
                        {event.after !== null ? (
                          <pre className="text-xs bg-green-50 border border-green-200 rounded p-1 overflow-x-auto max-w-xl">
                            after: {JSON.stringify(event.after, null, 1)}
                          </pre>
                        ) : null}
                      </div>
                    </details>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-gray-300 px-2 py-3 text-gray-600">No events match.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <p className="text-xs text-gray-600">
          Page {pageNumber} of {pages}.{' '}
          {pageNumber > 1 ? (
            <a href={`?page=${pageNumber - 1}`} className="text-blue-700 hover:underline mr-2">← newer</a>
          ) : null}
          {pageNumber < pages ? (
            <a href={`?page=${pageNumber + 1}`} className="text-blue-700 hover:underline">older →</a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
