import Link from 'next/link';
import { EnrolmentManager, type RosterRow } from '@/components/EnrolmentManager';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function EnrolmentPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      batchId: true,
      batch: {
        select: {
          name: true,
          roster: {
            orderBy: { registerNumber: 'asc' },
            select: { id: true, registerNumber: true, student: { select: { fullName: true } } },
          },
        },
      },
      enrolments: { select: { rosterEntryId: true, _count: { select: { markValues: true } } } },
    },
  });
  const canEdit = (await guard.check(user.userId, { type: 'course.write', courseId })).allow;

  const enrolledByRoster = new Map(course.enrolments.map((e) => [e.rosterEntryId, e._count.markValues > 0]));
  const roster: RosterRow[] = course.batch.roster.map((entry) => ({
    rosterEntryId: entry.id,
    registerNumber: entry.registerNumber,
    studentName: entry.student.fullName,
    enrolled: enrolledByRoster.has(entry.id),
    hasMarks: enrolledByRoster.get(entry.id) ?? false,
  }));

  return (
    <div className="space-y-3 max-w-3xl">
      <h2 className="font-medium">Enrolment — drawn from the {course.batch.name} roster</h2>
      {course.batch.roster.length === 0 ? (
        <p className="text-gray-600">
          The batch roster is empty. Import it first on the{' '}
          <Link href={`/batches/${course.batchId}/roster`} className="text-blue-700 hover:underline">batch roster page</Link>.
        </p>
      ) : !canEdit ? (
        <p className="text-gray-600">{roster.filter((r) => r.enrolled).length} students enrolled (read-only).</p>
      ) : (
        <EnrolmentManager courseId={courseId} roster={roster} />
      )}
    </div>
  );
}
