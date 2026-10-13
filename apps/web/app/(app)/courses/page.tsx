import Link from 'next/link';
import { deleteCourseAction } from '@/actions/course';
import { ConfirmRemove } from '@/components/ConfirmRemove';
import { CourseGroups } from '@/components/CourseGroups';
import { courseDeletionSummary } from '@/lib/catalogueRemoval';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * The courses this user works with — own courses for faculty, every
 * course of the department for an HoD (across all its programmes). The
 * list is scoped by the same rules the Guard enforces; opening a course
 * still passes through guard.require on every read.
 *
 * This was the landing page until the dashboard took that place. It
 * stays as the plain catalogue: the dashboard says what needs doing, and
 * this says what exists.
 */
export default async function CoursesPage() {
  const user = await requireSession();

  // CR-3: the Controller of Examinations owns the catalogue and the
  // end-semester examination of every theory course, so they see all of
  // them — the one role whose scope is the whole college here.
  const isCoe = user.roles.some((role) => role.kind === 'COE');
  // CR-9: the administrator may delete a course too, so sees the
  // catalogue — code, title, batch, staffing, status. Not the course
  // itself: course.read stays denied, so the code is not a link for them.
  const isAdmin = user.isAdmin;
  const opensCourses = !isAdmin || isCoe;

  const courses = await prisma.course.findMany({
    where: isCoe || isAdmin
      ? undefined
      : {
          OR: [
            { instructors: { some: { userId: user.userId } } },
            ...(user.hodDepartmentIds.length > 0
              ? [{ batch: { programme: { departmentId: { in: user.hodDepartmentIds } } } }]
              : []),
          ],
        },
    include: {
      batch: { include: { programme: { include: { department: true } } } },
      instructors: { include: { user: { select: { fullName: true } } } },
      snapshots: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
      _count: { select: { cos: true, assessments: true, enrolments: true } },
    },
    orderBy: [{ code: 'asc' }],
  });

  const canCreate = isCoe;
  // Offers the button only; deleteCourseAction asks the Guard
  // (`course.delete`, DRAFT only) and refuses while recorded work exists.
  const offersDelete = (status: string) => (isCoe || isAdmin) && status === 'DRAFT';

  // Grouped by programme, then batch (newest first); the headings carry
  // both, so the rows do not repeat them.
  const grouped = courses.map((course) => ({
    ...course,
    programmeId: course.batch.programmeId,
    programmeName: course.batch.programme.name,
    departmentName: course.batch.programme.department.name,
    batchName: course.batch.name,
    batchStartYear: course.batch.startYear,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Courses</h1>
        {canCreate ? (
          <Link href="/courses/new" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">
            New course
          </Link>
        ) : null}
      </div>

      {courses.length === 0 ? (
        <p className="text-gray-600">
          No courses yet.{' '}
          {canCreate
            ? 'Create the first one.'
            : 'Courses appear here once the Controller of Examinations creates one and your HoD assigns you to it.'}
        </p>
      ) : (
        <CourseGroups
          courses={grouped}
          // College-wide for the COE and the administrator, so each
          // programme heading names its department.
          showDepartment={isCoe || isAdmin}
          renderTable={(batchCourses) => (
            <table className="w-full bg-white border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-1">Code</th>
                  <th className="border border-gray-300 px-2 py-1">Title</th>
                  <th className="border border-gray-300 px-2 py-1">Sem</th>
                  <th className="border border-gray-300 px-2 py-1">Faculty</th>
                  <th className="border border-gray-300 px-2 py-1">COs</th>
                  <th className="border border-gray-300 px-2 py-1">Assessments</th>
                  <th className="border border-gray-300 px-2 py-1">Status</th>
                  {isCoe || isAdmin ? <th className="border border-gray-300 px-2 py-1 w-64" aria-label="Delete" /> : null}
                </tr>
              </thead>
              <tbody>
                {batchCourses.map((course) => (
                  <tr key={course.id} className="hover:bg-blue-50">
                    <td className="border border-gray-300 px-2 py-1">
                      {opensCourses ? (
                        <Link href={`/courses/${course.id}`} className="text-blue-700 hover:underline font-medium">
                          {course.code}
                        </Link>
                      ) : (
                        <span className="font-medium">{course.code}</span>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1">{course.title}</td>
                    <td className="border border-gray-300 px-2 py-1">{course.semester}</td>
                    <td className="border border-gray-300 px-2 py-1">
                      {course.instructors.map((i) => i.user.fullName).join(', ') || '—'}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{course._count.cos}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center">{course._count.assessments}</td>
                    <td className="border border-gray-300 px-2 py-1 whitespace-nowrap">
                      {course.status}
                      {course.snapshots[0] ? (
                        <span className="text-xs text-gray-500"> · v{course.snapshots[0].version}</span>
                      ) : null}
                    </td>
                    {isCoe || isAdmin ? (
                      <td className="border border-gray-300 px-2 py-1">
                        {offersDelete(course.status) ? (
                          <ConfirmRemove
                            action={deleteCourseAction.bind(null, course.id)}
                            summary={courseDeletionSummary(course, {
                              cos: course._count.cos,
                              assessments: course._count.assessments,
                              enrolments: course._count.enrolments,
                              instructors: course.instructors.length,
                            })}
                            label="Delete"
                            confirmLabel="Yes, delete course"
                            pendingLabel="Deleting…"
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      )}
    </div>
  );
}
