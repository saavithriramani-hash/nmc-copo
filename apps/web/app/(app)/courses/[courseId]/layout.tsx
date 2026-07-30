import { notFound, redirect } from 'next/navigation';
import { AuthzDeniedError } from '@copo/auth';
import { CourseTabs } from '@/components/CourseTabs';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * Course hub shell. Reading ANY course page passes through the Guard
 * here (course.read); every mutation re-guards itself in its action.
 * A course the user may not read — or a guessed id — looks identical:
 * not found.
 */
export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const user = await requireSession();
  const { courseId } = await params;

  try {
    await guard.require(user.userId, { type: 'course.read', courseId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      if (err.reason === 'RESOURCE_NOT_FOUND') notFound();
      redirect('/');
    }
    throw err;
  }

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: { batch: { include: { programme: true } } },
  });

  const tabs = [
    { href: `/courses/${courseId}`, label: 'Details' },
    { href: `/courses/${courseId}/outcomes`, label: 'Course outcomes' },
    { href: `/courses/${courseId}/matrix`, label: 'Articulation matrix' },
    { href: `/courses/${courseId}/assessments`, label: 'Assessments' },
    { href: `/courses/${courseId}/enrolment`, label: 'Enrolment' },
    { href: `/courses/${courseId}/marks`, label: 'Marks' },
    { href: `/courses/${courseId}/feedback`, label: 'Feedback' },
    { href: `/courses/${courseId}/review`, label: 'Review' },
    { href: `/courses/${courseId}/attainment`, label: 'Attainment' },
    { href: `/courses/${courseId}/versions`, label: 'Versions' },
    { href: `/courses/${courseId}/settings`, label: 'Parameters' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">
            {course.code} — {course.title}
          </h1>
          <p className="text-xs text-gray-600">
            {course.batch.programme.name} · {course.batch.name} · Semester {course.semester} ·{' '}
            <span className={course.status === 'LOCKED' ? 'text-red-700 font-medium' : ''}>{course.status}</span>
          </p>
        </div>
      </div>
      <CourseTabs tabs={tabs} basePath={`/courses/${courseId}`} />
      {children}
    </div>
  );
}
