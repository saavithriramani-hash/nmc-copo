'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { normaliseBloomLevels, validateBloomLevels } from '@/lib/bloom';
import { requireSession } from '@/lib/session';

export interface CoRow {
  id: string | null;
  code: string;
  statement: string;
  /** One or more Bloom levels; stored in taxonomy order (FR-5, extended). */
  bloomLevels: string[];
}

/** Replace-all save of a course's CO list (FR-5). */
export async function saveCosAction(courseId: string, rows: CoRow[]): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.write', courseId });

  for (const row of rows) {
    if (!row.code.trim() || !row.statement.trim()) return { error: 'Every CO needs a code and a statement.' };
    const problem = validateBloomLevels(row.bloomLevels);
    if (problem) return { error: `${row.code.trim() || 'A CO'}: ${problem}` };
  }
  const codes = rows.map((r) => r.code.trim());
  if (new Set(codes).size !== codes.length) return { error: 'CO codes must be unique.' };

  const existing = await prisma.courseOutcome.findMany({ where: { courseId } });
  const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id as string));
  const removed = existing.filter((co) => !keptIds.has(co.id));

  try {
    await prisma.$transaction(async (tx) => {
      for (const co of removed) {
        // Matrix cells for a removed CO go with it (setup data, derived
        // weightages recompute); an item still tagged to it must block.
        await tx.articulationMatrix.deleteMany({ where: { coId: co.id } });
        await tx.assessmentCoTag.deleteMany({ where: { coId: co.id } });
        await tx.indirectFeedback.deleteMany({ where: { coId: co.id } });
        await tx.courseOutcome.delete({ where: { id: co.id } });
      }
      for (const [index, row] of rows.entries()) {
        const bloomLevels = normaliseBloomLevels(row.bloomLevels);
        if (row.id) {
          await tx.courseOutcome.update({
            where: { id: row.id },
            data: { code: row.code.trim(), statement: row.statement.trim(), bloomLevels, displayOrder: index + 1 },
          });
        } else {
          await tx.courseOutcome.create({
            data: {
              courseId,
              code: row.code.trim(),
              statement: row.statement.trim(),
              bloomLevels,
              displayOrder: index + 1,
            },
          });
        }
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return { error: 'A removed CO is still tagged on an assessment item. Untag it there first.' };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'COS_SAVED',
    entityType: 'Course',
    entityId: courseId,
    before: existing.map((c) => ({ code: c.code, statement: c.statement, bloomLevels: c.bloomLevels })),
    after: rows.map((r) => ({ code: r.code, statement: r.statement, bloomLevels: normaliseBloomLevels(r.bloomLevels) })),
  });
  revalidatePath(`/courses/${courseId}`, 'layout');
  return { ok: true };
}
