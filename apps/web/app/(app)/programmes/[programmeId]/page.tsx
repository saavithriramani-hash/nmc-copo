import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createBatchAction } from '@/actions/structure';
import { OutcomeEditor } from '@/components/OutcomeEditor';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function ProgrammePage({
  params,
  searchParams,
}: {
  params: Promise<{ programmeId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireSession();
  const { programmeId } = await params;
  const { error } = await searchParams;

  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    include: {
      department: true,
      outcomes: { orderBy: { displayOrder: 'asc' } },
      batches: { orderBy: { startYear: 'desc' }, include: { _count: { select: { courses: true, roster: true } } } },
    },
  });
  if (!programme) notFound();

  const canManageOutcomes = (await guard.check(user.userId, { type: 'programme.manage', programmeId })).allow;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">{programme.name}</h1>
          <p className="text-xs text-gray-600">{programme.department.name}</p>
        </div>
        <Link href={`/programmes/${programme.id}/consolidation`} className="text-sm text-blue-700 hover:underline">
          Programme consolidation →
        </Link>
      </div>
      {error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p> : null}

      <section className="space-y-2">
        <h2 className="font-medium">Programme outcomes (POs &amp; PSOs)</h2>
        {canManageOutcomes ? (
          <OutcomeEditor
            programmeId={programme.id}
            initial={programme.outcomes.map((o) => ({ id: o.id, code: o.code, kind: o.kind, statement: o.statement }))}
          />
        ) : (
          <table className="w-full bg-white border-collapse">
            <tbody>
              {programme.outcomes.map((o) => (
                <tr key={o.id}>
                  <td className="border border-gray-300 px-2 py-1 w-24 font-medium">{o.code}</td>
                  <td className="border border-gray-300 px-2 py-1 w-16">{o.kind}</td>
                  <td className="border border-gray-300 px-2 py-1">{o.statement}</td>
                </tr>
              ))}
              {programme.outcomes.length === 0 ? (
                <tr>
                  <td className="border border-gray-300 px-2 py-2 text-gray-600">Not defined yet — the programme coordinator defines these.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Batches</h2>
        <table className="w-full bg-white border-collapse max-w-2xl">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1">Batch</th>
              <th className="border border-gray-300 px-2 py-1">Courses</th>
              <th className="border border-gray-300 px-2 py-1">Roster</th>
            </tr>
          </thead>
          <tbody>
            {programme.batches.map((batch) => (
              <tr key={batch.id}>
                <td className="border border-gray-300 px-2 py-1 font-medium">{batch.name}</td>
                <td className="border border-gray-300 px-2 py-1 text-center">{batch._count.courses}</td>
                <td className="border border-gray-300 px-2 py-1 text-center">
                  <Link href={`/batches/${batch.id}/roster`} className="text-blue-700 hover:underline">
                    {batch._count.roster} students
                  </Link>
                </td>
              </tr>
            ))}
            {programme.batches.length === 0 ? (
              <tr>
                <td colSpan={3} className="border border-gray-300 px-2 py-2 text-gray-600">No batches yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {user.isAdmin ? (
          <form action={createBatchAction} className="flex items-center gap-2">
            <input type="hidden" name="programmeId" value={programme.id} />
            <input name="startYear" type="number" required placeholder="Start year" className="w-28 border border-gray-300 rounded px-2 py-1" />
            <span className="text-gray-500">–</span>
            <input name="endYear" type="number" required placeholder="End year" className="w-28 border border-gray-300 rounded px-2 py-1" />
            <button type="submit" className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">Add batch</button>
          </form>
        ) : null}
      </section>

      <p className="text-xs text-gray-500">
        Course setup lives on each course page — <Link href="/" className="text-blue-700 hover:underline">Courses</Link>.
      </p>
    </div>
  );
}
