import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * Landing: the courses this user works with — own courses for faculty,
 * every course of the department for an HoD (across all its programmes).
 * The list is scoped by the same rules the Guard enforces; opening a
 * course still passes through guard.require on every read.
 */
export default async function HomePage() {
  const user = await requireSession();

  // CR-3: the Controller of Examinations owns the catalogue and the
  // end-semester examination of every theory course, so they see all of
  // them — the one role whose scope is the whole college here.
  const isCoe = user.roles.some((role) => role.kind === 'COE');

  const courses = await prisma.course.findMany({
    where: isCoe
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
        <table className="w-full bg-white border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1">Code</th>
              <th className="border border-gray-300 px-2 py-1">Title</th>
              <th className="border border-gray-300 px-2 py-1">Programme / Batch</th>
              <th className="border border-gray-300 px-2 py-1">Sem</th>
              <th className="border border-gray-300 px-2 py-1">Faculty</th>
              <th className="border border-gray-300 px-2 py-1">COs</th>
              <th className="border border-gray-300 px-2 py-1">Assessments</th>
              <th className="border border-gray-300 px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id} className="hover:bg-blue-50">
                <td className="border border-gray-300 px-2 py-1">
                  <Link href={`/courses/${course.id}`} className="text-blue-700 hover:underline font-medium">
                    {course.code}
                  </Link>
                </td>
                <td className="border border-gray-300 px-2 py-1">{course.title}</td>
                <td className="border border-gray-300 px-2 py-1">
                  {course.batch.programme.name} · {course.batch.name}
                </td>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
