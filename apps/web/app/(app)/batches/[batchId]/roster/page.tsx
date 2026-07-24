import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RosterImport } from '@/components/RosterImport';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function BatchRosterPage({ params }: { params: Promise<{ batchId: string }> }) {
  const user = await requireSession();
  const { batchId } = await params;

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: {
      programme: { include: { department: true } },
      roster: {
        orderBy: { registerNumber: 'asc' },
        include: { student: { select: { fullName: true, email: true } }, _count: { select: { enrolments: true } } },
      },
    },
  });
  if (!batch) notFound();

  const canManage = (await guard.check(user.userId, { type: 'roster.manage', departmentId: batch.programme.departmentId })).allow;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Roster — {batch.name}</h1>
        <p className="text-xs text-gray-600">
          {batch.programme.name} · {batch.programme.department.name} ·{' '}
          <Link href={`/programmes/${batch.programmeId}`} className="text-blue-700 hover:underline">programme</Link>
        </p>
      </div>

      {canManage ? <RosterImport batchId={batchId} /> : null}

      <section className="space-y-2">
        <h2 className="font-medium">{batch.roster.length} students</h2>
        {batch.roster.length === 0 ? (
          <p className="text-gray-600">No students yet. {canManage ? 'Import a roster above.' : 'The department imports the roster.'}</p>
        ) : (
          <table className="w-full bg-white border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="border border-gray-300 px-2 py-1 w-40">Register no.</th>
                <th className="border border-gray-300 px-2 py-1">Name</th>
                <th className="border border-gray-300 px-2 py-1">Email</th>
                <th className="border border-gray-300 px-2 py-1 w-32">Courses enrolled</th>
              </tr>
            </thead>
            <tbody>
              {batch.roster.map((entry) => (
                <tr key={entry.id}>
                  <td className="border border-gray-300 px-2 py-1 font-mono">{entry.registerNumber}</td>
                  <td className="border border-gray-300 px-2 py-1">{entry.student.fullName}</td>
                  <td className="border border-gray-300 px-2 py-1 text-gray-600">{entry.student.email ?? '—'}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{entry._count.enrolments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
