import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createDepartmentAction, createInstitutionAction, createProgrammeAction } from '@/actions/structure';
import { StructureControls } from '@/components/StructureControls';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { pluralise } from '@/lib/structureAdmin';

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireSession();
  if (!user.isAdmin) redirect('/');
  const { error } = await searchParams;

  const institution = await prisma.institution.findFirst();
  const departments = await prisma.department.findMany({
    include: {
      programmes: {
        include: { _count: { select: { batches: true, outcomes: true } } },
        orderBy: { name: 'asc' },
      },
      _count: { select: { programmes: true, roles: true, templates: true } },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Departments &amp; programmes</h1>
      {error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p> : null}

      {!institution ? (
        <form action={createInstitutionAction} className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-lg">
          <p className="font-medium">Create the institution</p>
          <p className="text-xs text-gray-600">
            One institution record holds the default attainment parameters (§4). Defaults are the confirmed values;
            the IQAC can adjust them later.
          </p>
          <div className="flex gap-2">
            <input name="name" required placeholder="Institution name" className="flex-1 border border-gray-300 rounded px-2 py-1.5" />
            <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Create</button>
          </div>
        </form>
      ) : (
        <>
          <form action={createDepartmentAction} className="flex gap-2 max-w-lg">
            <input name="name" required placeholder="New department name (e.g. Mathematics)" className="flex-1 border border-gray-300 rounded px-2 py-1.5" />
            <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Add department</button>
          </form>

          <table className="w-full bg-white border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="border border-gray-300 px-2 py-1 w-64">Department</th>
                <th className="border border-gray-300 px-2 py-1">Programmes</th>
                <th className="border border-gray-300 px-2 py-1 w-96">Add programme</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((dept) => (
                <tr key={dept.id}>
                  <td className="border border-gray-300 px-2 py-1 align-top space-y-1">
                    <div className="font-medium">{dept.name}</div>
                    <StructureControls kind="department" id={dept.id} name={dept.name} />
                  </td>
                  <td className="border border-gray-300 px-2 py-1 align-top">
                    {dept.programmes.length === 0 ? (
                      <span className="text-gray-500">—</span>
                    ) : (
                      <ul className="space-y-2">
                        {dept.programmes.map((programme) => (
                          <li key={programme.id} className="space-y-1">
                            <div>
                              <Link href={`/programmes/${programme.id}`} className="text-blue-700 hover:underline">
                                {programme.name}
                              </Link>
                              <span className="text-xs text-gray-500">
                                {' '}
                                ({pluralise(programme._count.batches, 'batch', 'batches')})
                              </span>
                            </div>
                            <StructureControls
                              kind="programme"
                              id={programme.id}
                              name={programme.name}
                              outcomeCount={programme._count.outcomes}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 align-top">
                    <form action={createProgrammeAction} className="flex gap-2">
                      <input type="hidden" name="departmentId" value={dept.id} />
                      <input name="name" required placeholder="e.g. B.Sc. Mathematics" className="flex-1 border border-gray-300 rounded px-2 py-1" />
                      <button type="submit" className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">Add</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
