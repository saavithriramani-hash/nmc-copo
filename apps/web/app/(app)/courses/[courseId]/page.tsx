import { addInstructorAction, deleteCourseAction, removeInstructorAction } from '@/actions/course';
import { AddInstructorForm } from '@/components/AddInstructorForm';
import { ConfirmRemove } from '@/components/ConfirmRemove';
import { OfferToBatchForm } from '@/components/OfferToBatchForm';
import { CourseDetailsForm } from '@/components/CourseDetailsForm';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { courseDeletionSummary } from '@/lib/catalogueRemoval';
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
    include: {
      instructors: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      batch: { select: { programmeId: true, programme: { select: { departmentId: true } } } },
      _count: { select: { cos: true, assessments: true, enrolments: true } },
    },
  });
  // CR-3: the catalogue entry — code, title, semester, credits and
  // whether this is a practical paper — belongs to the Controller of
  // Examinations. Everyone else reads it.
  const canWrite = (await guard.check(user.userId, { type: 'course.details.write', courseId })).allow;
  // Staffing is a separate authority (FR-4): the HoD decides who teaches.
  const canStaff = (await guard.check(user.userId, { type: 'course.staff', courseId })).allow;
  // CR-9: removing the catalogue entry — the COE (or administrator), DRAFT only.
  const canDelete = (await guard.check(user.userId, { type: 'course.delete', courseId })).allow;
  // CR-10: offering the paper to the next intake creates a course there —
  // the same authority as creating one by hand. Same programme only.
  const canOffer = (
    await guard.check(user.userId, { type: 'course.create', departmentId: course.batch.programme.departmentId })
  ).allow;
  const offerBatches = canOffer
    ? (
        await prisma.batch.findMany({
          where: { programmeId: course.batch.programmeId, id: { not: course.batchId } },
          select: { id: true, name: true, courses: { where: { code: course.code }, select: { id: true } } },
          orderBy: { startYear: 'asc' },
        })
      ).map((batch) => ({ id: batch.id, name: batch.name, hasCode: batch.courses.length > 0 }))
    : [];

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

      {canOffer ? (
        <section className="space-y-2">
          <h2 className="font-medium">Offer to another batch</h2>
          <p className="text-xs text-gray-500">
            Creates this course for another batch of the same programme — the next year&apos;s intake — as a separate
            DRAFT course with the same details, COs, assessments and articulation matrix. Marks, students, faculty and
            parameter overrides are not carried over (CR-10).
          </p>
          <OfferToBatchForm courseId={courseId} code={course.code} batches={offerBatches} />
        </section>
      ) : null}

      {canDelete ? (
        <section className="space-y-2">
          <h2 className="font-medium">Delete course</h2>
          <p className="text-xs text-gray-500">
            For a course created by mistake or withdrawn before it ran. Refused while any marks, learner ratings or review
            history exist (CR-9).
          </p>
          <ConfirmRemove
            action={deleteCourseAction.bind(null, courseId, true)}
            summary={courseDeletionSummary(course, {
              cos: course._count.cos,
              assessments: course._count.assessments,
              enrolments: course._count.enrolments,
              instructors: course.instructors.length,
            })}
            label="Delete course"
            confirmLabel="Yes, delete course"
            pendingLabel="Deleting…"
          />
        </section>
      ) : null}
    </div>
  );
}
