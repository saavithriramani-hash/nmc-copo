'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';

/**
 * Enrolment (FR-10): a course draws its students FROM the batch roster —
 * faculty pick roster members, never type register numbers. Each
 * Enrolment references a roster entry by foreign key; the batch is
 * duplicated and composite-FK-pinned so a cross-batch enrolment cannot
 * exist.
 */
export async function setEnrolmentAction(
  courseId: string,
  rosterEntryIds: string[],
): Promise<{ ok: boolean; enrolled?: number; removed?: number; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.write', courseId });

  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { batchId: true } });

  // Only roster entries of THIS course's batch are enrollable.
  const validRoster = new Set(
    (await prisma.batchRoster.findMany({ where: { batchId: course.batchId }, select: { id: true } })).map((r) => r.id),
  );
  const wanted = new Set(rosterEntryIds.filter((id) => validRoster.has(id)));

  const current = await prisma.enrolment.findMany({ where: { courseId }, select: { id: true, rosterEntryId: true } });
  const currentByRoster = new Map(current.map((e) => [e.rosterEntryId, e.id]));

  const toAdd = [...wanted].filter((rosterEntryId) => !currentByRoster.has(rosterEntryId));
  const toRemove = current.filter((e) => !wanted.has(e.rosterEntryId));

  try {
    await prisma.$transaction(async (tx) => {
      if (toAdd.length > 0) {
        await tx.enrolment.createMany({
          data: toAdd.map((rosterEntryId) => ({ courseId, rosterEntryId, batchId: course.batchId })),
        });
      }
      for (const enrolment of toRemove) {
        // Removing an enrolment with marks would orphan them; the FK
        // RESTRICT blocks it, surfaced as a clear message.
        await tx.enrolment.delete({ where: { id: enrolment.id } });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return { ok: false, error: 'A student you removed already has marks recorded. Clear their marks first.' };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'ENROLMENT_UPDATED',
    entityType: 'Course',
    entityId: courseId,
    after: { enrolled: toAdd.length, removed: toRemove.length, total: wanted.size },
  });
  revalidatePath(`/courses/${courseId}/enrolment`);
  return { ok: true, enrolled: toAdd.length, removed: toRemove.length };
}
