import Link from 'next/link';
import { assessmentMarkSummary } from '@copo/db';
import { CourseMarkImport } from '@/components/CourseMarkImport';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/** Marks tab: pick an assessment to enter marks for. */
export default async function MarksIndexPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;
  const canWrite = (await guard.check(user.userId, { type: 'marks.write', courseId })).allow;

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      _count: { select: { enrolments: true } },
      assessments: {
        orderBy: { displayOrder: 'asc' },
        select: { id: true, name: true, shape: true, weightGroup: true, _count: { select: { items: true } } },
      },
    },
  });

  if (course._count.enrolments === 0) {
    return (
      <p className="text-gray-600">
        No students are enrolled yet. Draw enrolment from the roster on the{' '}
        <Link href={`/courses/${courseId}/enrolment`} className="text-blue-700 hover:underline">Enrolment</Link> tab first.
      </p>
    );
  }

  // Per-assessment completeness: attempted cells vs the full grid, aggregated in SQL.
  const summaries = await Promise.all(
    course.assessments.map(async (assessment) => {
      const perItem = await assessmentMarkSummary(prisma, assessment.id);
      const attempted = perItem.reduce((sum, item) => sum + item.attempted, 0);
      const cells = assessment._count.items * course._count.enrolments;
      return { attempted, cells };
    }),
  );

  return (
    <div className="space-y-2 max-w-3xl">
      <h2 className="font-medium">Mark entry · {course._count.enrolments} students</h2>
      {course.assessments.length === 0 ? (
        <p className="text-gray-600">
          No assessments yet — add them on the{' '}
          <Link href={`/courses/${courseId}/assessments`} className="text-blue-700 hover:underline">Assessments</Link> tab.
        </p>
      ) : (
        <table className="w-full bg-white border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1">Assessment</th>
              <th className="border border-gray-300 px-2 py-1">Group</th>
              <th className="border border-gray-300 px-2 py-1">Items</th>
              <th className="border border-gray-300 px-2 py-1">Marks entered</th>
            </tr>
          </thead>
          <tbody>
            {course.assessments.map((assessment, i) => {
              const s = summaries[i]!;
              return (
                <tr key={assessment.id} className="hover:bg-blue-50">
                  <td className="border border-gray-300 px-2 py-1">
                    <Link href={`/courses/${courseId}/marks/${assessment.id}`} className="text-blue-700 hover:underline font-medium">
                      {assessment.name}
                    </Link>
                  </td>
                  <td className="border border-gray-300 px-2 py-1">{assessment.weightGroup}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{assessment._count.items}</td>
                  <td className="border border-gray-300 px-2 py-1">
                    {s.attempted} / {s.cells}
                    {s.cells > 0 ? <span className="text-gray-500"> ({Math.round((s.attempted / s.cells) * 100)}%)</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-xs text-gray-500">
        “Marks entered” counts attempted cells; blanks are deliberate (did not attempt) and are not counted.
      </p>

      {/* Below the list, not above it: entering marks assessment by
          assessment is the normal path, and the workbook is the bulk
          alternative for someone who already has the figures to hand. */}
      {canWrite && course.assessments.length > 0 ? <CourseMarkImport courseId={courseId} /> : null}
    </div>
  );
}
