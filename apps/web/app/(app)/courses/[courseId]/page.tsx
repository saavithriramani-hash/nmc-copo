import { addInstructorAction, removeInstructorAction, updateCourseDetailsAction } from '@/actions/course';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function CourseDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireSession();
  const { courseId } = await params;
  const { error } = await searchParams;

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: { instructors: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
  });
  const canWrite = (await guard.check(user.userId, { type: 'course.write', courseId })).allow;

  const updateAction = updateCourseDetailsAction.bind(null, courseId);
  const addAction = addInstructorAction.bind(null, courseId);

  return (
    <div className="space-y-6 max-w-2xl">
      {error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p> : null}

      <section className="space-y-2">
        <h2 className="font-medium">Details</h2>
        <form action={updateAction} className="bg-white border border-gray-300 rounded p-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Code</span>
            <input name="code" defaultValue={course.code} required disabled={!canWrite} className="w-full border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Semester</span>
            <input name="semester" type="number" min={1} max={12} defaultValue={course.semester} required disabled={!canWrite} className="w-full border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          <label className="block col-span-2">
            <span className="block text-xs font-medium text-gray-700 mb-1">Title</span>
            <input name="title" defaultValue={course.title} required disabled={!canWrite} className="w-full border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Credits</span>
            <input name="credits" type="number" step="0.5" min={0} defaultValue={course.credits?.toString() ?? ''} disabled={!canWrite} className="w-full border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          {canWrite ? (
            <div className="flex items-end">
              <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Save details</button>
            </div>
          ) : null}
        </form>
        {!canWrite ? <p className="text-xs text-gray-500">Read-only: course setup is edited by its faculty while in DRAFT, or by the HoD.</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Assigned faculty</h2>
        <table className="w-full bg-white border-collapse">
          <tbody>
            {course.instructors.map((instructor) => (
              <tr key={instructor.userId}>
                <td className="border border-gray-300 px-2 py-1">{instructor.user.fullName}</td>
                <td className="border border-gray-300 px-2 py-1">{instructor.user.email}</td>
                <td className="border border-gray-300 px-2 py-1 w-24 text-center">
                  {canWrite ? (
                    <form action={removeInstructorAction.bind(null, courseId, instructor.userId)}>
                      <button type="submit" className="text-red-700 hover:underline">remove</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
            {course.instructors.length === 0 ? (
              <tr>
                <td className="border border-gray-300 px-2 py-2 text-gray-600">No faculty assigned yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {canWrite ? (
          <form action={addAction} className="flex gap-2 max-w-md">
            <input name="email" type="email" required placeholder="faculty email address" className="flex-1 border border-gray-300 rounded px-2 py-1" />
            <button type="submit" className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">Add faculty</button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
