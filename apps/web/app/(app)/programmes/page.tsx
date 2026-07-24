import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function ProgrammesPage() {
  await requireSession();

  const programmes = await prisma.programme.findMany({
    include: {
      department: true,
      _count: { select: { outcomes: true, batches: true } },
    },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Programmes</h1>
      <table className="w-full bg-white border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1">Programme</th>
            <th className="border border-gray-300 px-2 py-1">Department</th>
            <th className="border border-gray-300 px-2 py-1">POs/PSOs</th>
            <th className="border border-gray-300 px-2 py-1">Batches</th>
          </tr>
        </thead>
        <tbody>
          {programmes.map((programme) => (
            <tr key={programme.id} className="hover:bg-blue-50">
              <td className="border border-gray-300 px-2 py-1">
                <Link href={`/programmes/${programme.id}`} className="text-blue-700 hover:underline font-medium">
                  {programme.name}
                </Link>
              </td>
              <td className="border border-gray-300 px-2 py-1">{programme.department.name}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{programme._count.outcomes}</td>
              <td className="border border-gray-300 px-2 py-1 text-center">{programme._count.batches}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {programmes.length === 0 ? <p className="text-gray-600">No programmes yet — the administrator creates them under Departments.</p> : null}
    </div>
  );
}
