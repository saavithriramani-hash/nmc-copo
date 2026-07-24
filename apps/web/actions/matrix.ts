'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';

export interface MatrixCellInput {
  coId: string;
  poId: string;
  strength: 1 | 2 | 3;
}

/**
 * Replace-all save of a course's articulation matrix (FR-6). Blank cells
 * are simply absent — "unmapped" is the absence of a row, never a zero.
 * Weightages are never stored; they are recomputed from these rows on
 * every read (engine Step 1).
 */
export async function saveMatrixAction(courseId: string, cells: MatrixCellInput[]): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'matrix.write', courseId });

  const cos = await prisma.courseOutcome.findMany({ where: { courseId }, select: { id: true } });
  const coIds = new Set(cos.map((co) => co.id));
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { batch: { select: { programme: { select: { outcomes: { select: { id: true } } } } } } },
  });
  const poIds = new Set(course.batch.programme.outcomes.map((po) => po.id));

  for (const cell of cells) {
    if (!coIds.has(cell.coId)) return { error: 'A cell references a CO that is not part of this course.' };
    if (!poIds.has(cell.poId)) return { error: 'A cell references a PO/PSO outside this programme.' };
    if (cell.strength !== 1 && cell.strength !== 2 && cell.strength !== 3) {
      return { error: 'Correlation strengths are 1, 2 or 3 — or blank for unmapped.' };
    }
  }

  const before = await prisma.articulationMatrix.findMany({ where: { coId: { in: [...coIds] } } });

  await prisma.$transaction(async (tx) => {
    await tx.articulationMatrix.deleteMany({ where: { coId: { in: [...coIds] } } });
    if (cells.length > 0) {
      await tx.articulationMatrix.createMany({ data: cells });
    }
  });

  await logAudit({
    actorId: user.userId,
    action: 'MATRIX_SAVED',
    entityType: 'Course',
    entityId: courseId,
    before: before.map((c) => ({ coId: c.coId, poId: c.poId, strength: c.strength })),
    after: cells,
  });
  revalidatePath(`/courses/${courseId}/matrix`);
  return { ok: true };
}
