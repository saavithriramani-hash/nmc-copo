import Link from 'next/link';
import { MatrixGrid } from '@/components/MatrixGrid';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function MatrixPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: {
      cos: { orderBy: { displayOrder: 'asc' }, include: { matrixEntries: true } },
      batch: { include: { programme: { include: { outcomes: { orderBy: { displayOrder: 'asc' } } } } } },
    },
  });
  const canEdit = (await guard.check(user.userId, { type: 'matrix.write', courseId })).allow;

  const pos = course.batch.programme.outcomes;
  if (course.cos.length === 0 || pos.length === 0) {
    return (
      <p className="text-gray-600">
        The matrix needs both{' '}
        <Link href={`/courses/${courseId}/outcomes`} className="text-blue-700 hover:underline">course outcomes</Link> and the
        programme&apos;s <Link href={`/programmes/${course.batch.programmeId}`} className="text-blue-700 hover:underline">PO/PSO definitions</Link>.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-w-full">
      <h2 className="font-medium">CO ↔ PO/PSO articulation matrix</h2>
      <p className="text-xs text-gray-600">1 = low, 2 = medium, 3 = high correlation. Blank = unmapped.</p>
      <MatrixGrid
        courseId={courseId}
        canEdit={canEdit}
        cos={course.cos.map((co) => ({ id: co.id, code: co.code, statement: co.statement }))}
        pos={pos.map((po) => ({ id: po.id, code: po.code, kind: po.kind }))}
        initialCells={course.cos.flatMap((co) =>
          co.matrixEntries.map((cell) => ({ coId: cell.coId, poId: cell.poId, strength: cell.strength as 1 | 2 | 3 })),
        )}
      />
    </div>
  );
}
