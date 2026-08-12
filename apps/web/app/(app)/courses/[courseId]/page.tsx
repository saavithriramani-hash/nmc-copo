import { addInstructorAction, removeInstructorAction } from '@/actions/course';
import { AddInstructorForm } from '@/components/AddInstructorForm';
import { CourseDetailsForm } from '@/components/CourseDetailsForm';
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
  // CR-3: the catalogue entry — code, title, semester, credits and
  // whether this is a practical paper — belongs to the Controller of
  // Examinations. Everyone else reads it.
  const canWrite = (await guard.check(user.userId, { type: 'course.details.write', courseId })).allow;
  // Staffing is a separate authority (FR-4): the HoD decides who teaches.
  const canStaff = (await guard.check(user.userId, { type: 'course.staff', courseId })).allow;

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
        <CourseDetailsForm
          courseId={courseId}
          canWrite={canWrite}
          course={{
            code: course.code,
            title: course.title,
            semester: course.semester,
            credits: course.credits?.toString() ?? null,
            isLaboratory: course.isLaboratory,
          }}
        />
        {!canWrite ? (
          <p className="text-xs text-gray-500">
            Read-only: the course catalogue — code, title, semester, credits and the Laboratory flag — is kept by the
            Controller of Examinations (§2, CR-3). Everything else about the course is edited on its own tab.
          </p>
        ) : null}
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
