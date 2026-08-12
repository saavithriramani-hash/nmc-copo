import { redirect } from 'next/navigation';
import { createCourseAction } from '@/actions/course';
import { FacultyPicker } from '@/components/FacultyPicker';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * CR-3: the Controller of Examinations creates courses, in any batch of
 * any department — the catalogue is the examinations office's record.
 * Staffing remains the HoD's (FR-4), so the faculty field here is
 * optional and the course can be assigned later on its details tab.
 */
export default async function NewCoursePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireSession();
  if (!user.roles.some((role) => role.kind === 'COE')) redirect('/');
  const { error } = await searchParams;

  const batches = await prisma.batch.findMany({
    include: { programme: { include: { department: true } } },
    orderBy: [{ programme: { department: { name: 'asc' } } }, { programme: { name: 'asc' } }, { startYear: 'desc' }],
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
        <p className="text-gray-600">
          There are no batches yet. Create one on a programme page first — a course belongs to the cohort that takes it.
        </p>
      ) : (
        <form action={createCourseAction} className="bg-white border border-gray-300 rounded p-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Batch</span>
            <select name="batchId" required className="w-full border border-gray-300 rounded px-2 py-1.5">
              {/* Named by department too: the COE sees every batch in the
                  college, and two departments may run programmes whose
                  names read alike. */}
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.programme.department.name} · {batch.programme.name} — {batch.name}
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
            <div>
              <span className="block text-xs font-medium text-gray-700 mb-1">Assigned faculty</span>
              {/* A searchable picker rather than a <select>: a college
                  runs to ~200 active faculty, which no dropdown makes
                  navigable. Optional here — a course may be staffed
                  later on its details tab. */}
              <FacultyPicker
                name="instructorId"
                submit="id"
                options={facultyUsers}
                emptyOptionLabel="— assign later —"
                placeholder="Search name or email…"
              />
            </div>
          </div>
          <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Create course</button>
        </form>
      )}
    </div>
  );
}
