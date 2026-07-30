import Link from 'next/link';
import { FeedbackEditor } from '@/components/FeedbackEditor';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { draftFromStored } from '@/lib/indirectFeedback';
import { resolveCourseParameters } from '@/lib/params';
import { requireSession } from '@/lib/session';

/**
 * CO-wise indirect feedback (Procedure Step 8, FR-3).
 *
 * Editing is `course.write` — the faculty member on a DRAFT course, the
 * HoD until it is locked. Everyone who can read the course sees the
 * figures; a locked course is read-only for everyone.
 */
export default async function FeedbackPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  const cos = await prisma.courseOutcome.findMany({
    where: { courseId },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, code: true, statement: true },
  });

  if (cos.length === 0) {
    return (
      <p className="text-gray-600">
        Define the{' '}
        <Link href={`/courses/${courseId}/outcomes`} className="text-blue-700 hover:underline">
          course outcomes
        </Link>{' '}
        first — feedback is collected against them.
      </p>
    );
  }

  const [stored, { parameters }, canEdit] = await Promise.all([
    prisma.indirectFeedback.findMany({
      where: { coId: { in: cos.map((co) => co.id) } },
      select: { coId: true, n1: true, n2: true, n3: true },
    }),
    resolveCourseParameters(courseId),
    guard.check(user.userId, { type: 'course.write', courseId }).then((d) => d.allow),
  ]);

  const storedByCo = new Map(stored.map((row) => [row.coId, { n1: row.n1, n2: row.n2, n3: row.n3 }]));

  return (
    <FeedbackEditor
      courseId={courseId}
      cos={cos}
      initial={draftFromStored(cos.map((co) => co.id), storedByCo)}
      responseFloor={parameters.feedbackResponseFloor}
      canEdit={canEdit}
    />
  );
}
