import { redirect } from 'next/navigation';
import { createCourseAction } from '@/actions/course';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/** HoD-only: create a course in a batch of their department (FR-4). */
export default async function NewCoursePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireSession();
  if (user.hodDepartmentIds.length === 0) redirect('/');
  const { error } = await searchParams;

  const batches = await prisma.batch.findMany({
    where: { programme: { departmentId: { in: user.hodDepartmentIds } } },
    include: { programme: true },
    orderBy: [{ programme: { name: 'asc' } }, { startYear: 'desc' }],
  });
  const facultyUsers = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { kind: 'FACULTY', effectiveTo: null } } },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: 'asc' },
  });

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-lg font-semibold">New course</h1>
      {error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p> : null}
      {batches.length === 0 ? (
        <p className="text-gray-600">Your department has no batches yet — the administrator creates batches on the programme page.</p>
      ) : (
        <form action={createCourseAction} className="bg-white border border-gray-300 rounded p-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Batch</span>
            <select name="batchId" required className="w-full border border-gray-300 rounded px-2 py-1.5">
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.programme.name} — {batch.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Course code</span>
              <input name="code" required placeholder="MAT301" className="w-full border border-gray-300 rounded px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Semester</span>
              <input name="semester" type="number" min={1} max={12} required className="w-full border border-gray-300 rounded px-2 py-1.5" />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Title</span>
            <input name="title" required placeholder="Real Analysis" className="w-full border border-gray-300 rounded px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Credits (optional)</span>
              <input name="credits" type="number" step="0.5" min={0} className="w-full border border-gray-300 rounded px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Assigned faculty</span>
              <select name="instructorId" className="w-full border border-gray-300 rounded px-2 py-1.5">
                <option value="">— assign later —</option>
                {facultyUsers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.fullName} ({f.email})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Create course</button>
        </form>
      )}
    </div>
  );
}
