import { CoEditor } from '@/components/CoEditor';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function CourseOutcomesPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  const cos = await prisma.courseOutcome.findMany({ where: { courseId }, orderBy: { displayOrder: 'asc' } });
  const canEdit = (await guard.check(user.userId, { type: 'course.write', courseId })).allow;

  return (
    <div className="space-y-2 max-w-4xl">
      <h2 className="font-medium">Course outcomes</h2>
      <CoEditor
        courseId={courseId}
        canEdit={canEdit}
        initial={cos.map((co) => ({ id: co.id, code: co.code, statement: co.statement, bloomLevels: co.bloomLevels }))}
      />
    </div>
  );
}
