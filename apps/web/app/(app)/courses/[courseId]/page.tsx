import { addInstructorAction, removeInstructorAction, updateCourseDetailsAction } from '@/actions/course';
import { AddInstructorForm } from '@/components/AddInstructorForm';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { excludeAssigned } from '@/lib/facultySearch';
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
  // Staffing is a separate authority (FR-4): the HoD decides who teaches.
  const canStaff = (await guard.check(user.userId, { type: 'course.staff', courseId })).allow;

  const updateAction = updateCourseDetailsAction.bind(null, courseId);
  const addAction = addInstructorAction.bind(null, courseId);

  // Only offered when the viewer may actually staff the course: the list
  // of every faculty member in the college is not something a course's
  // own faculty needs, and the picker is hidden from them anyway.
  const assignableFaculty = canStaff
    ? excludeAssigned(
        await prisma.user.findMany({
          where: { isActive: true, roles: { some: { kind: 'FACULTY', effectiveTo: null } } },
          select: { id: true, fullName: true, email: true },
          orderBy: { fullName: 'asc' },
        }),
        course.instructors.map((instructor) => instructor.userId),
      )
    : [];

  return (
    <div className="space-y-6 max-w-2xl">
      {error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p> : null}

      <section className="space-y-2">
        <h2 className="font-medium">Details</h2>
        {/*
          Flex rather than a two-column grid: every field is sized to
          what it actually holds, and the button sits directly after the
          last one instead of being pushed to the far side of a column it
          never needed. The card is only as wide as the longest field.
        */}
        <form
          action={updateAction}
          className="bg-white border border-gray-300 rounded p-4 flex flex-wrap items-end gap-x-3 gap-y-2 max-w-xl"
        >
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Code</span>
            <input name="code" defaultValue={course.code} required disabled={!canWrite} className="w-40 border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Semester</span>
            {/* One or two digits. A wide box invites the reader to expect
                a long value. */}
            <input name="semester" type="number" min={1} max={12} defaultValue={course.semester} required disabled={!canWrite} className="w-16 border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Credits</span>
            {/* Wider than Semester only because it takes halves: "4.5". */}
            <input name="credits" type="number" step="0.5" min={0} defaultValue={course.credits?.toString() ?? ''} disabled={!canWrite} className="w-20 border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          {/* `w-full` breaks the line: the title is the one free-text
              field and gets the row to itself. */}
          <label className="block w-full">
            <span className="block text-xs font-medium text-gray-700 mb-1">Title</span>
            <input name="title" defaultValue={course.title} required disabled={!canWrite} className="w-full border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
          </label>
          {canWrite ? (
            <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Save details</button>
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
                  {canStaff ? (
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
        {canStaff ? (
          <AddInstructorForm action={addAction} options={assignableFaculty} />
        ) : (
          <p className="text-xs text-gray-500">
            Who teaches this course is set by the Head of Department (FR-4).
          </p>
        )}
      </section>
    </div>
  );
}
