'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { isEmpty, parseFeedbackDraft, type FeedbackDraft } from '@/lib/indirectFeedback';

/**
 * CO-wise indirect feedback (Procedure Step 8, FR-3).
 *
 * Guarded by `course.write`: this is course data entered by the faculty
 * member who ran the feedback, on a DRAFT course, and by the HoD until
 * the course is locked — the same rule as COs and assessments.
 *
 * A CO whose three counts are all zero is stored as NO ROW rather than a
 * row of zeros. The engine distinguishes them: no row means "no feedback
 * for this CO", which yields a null indirect value and a warning. A row
 * of zeros would be an assertion that zero people responded at every
 * level, which is the same thing said less clearly — and would risk a
 * future reader treating it as a measured zero.
 */
export type FeedbackResult = { error?: string; errors?: string[]; ok?: boolean; message?: string };

export async function saveIndirectFeedbackAction(courseId: string, draft: FeedbackDraft[]): Promise<FeedbackResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.write', courseId });

  const cos = await prisma.courseOutcome.findMany({
    where: { courseId },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, code: true },
  });
  const codeById = new Map(cos.map((co) => [co.id, co.code]));

  // Ignore anything that is not a CO of this course.
  const scoped = draft.filter((row) => codeById.has(row.coId));
  const parsed = parseFeedbackDraft(scoped, (coId) => codeById.get(coId) ?? coId);
  if ('errors' in parsed) return { errors: parsed.errors };

  const before = await prisma.indirectFeedback.findMany({
    where: { coId: { in: cos.map((co) => co.id) } },
    select: { coId: true, n1: true, n2: true, n3: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const row of parsed.rows) {
      if (isEmpty(row.counts)) {
        await tx.indirectFeedback.deleteMany({ where: { coId: row.coId } });
        continue;
      }
      await tx.indirectFeedback.upsert({
        where: { coId: row.coId },
        create: { coId: row.coId, ...row.counts },
        update: { ...row.counts },
      });
    }
  });

  const withFeedback = parsed.rows.filter((row) => !isEmpty(row.counts)).length;
  await logAudit({
    actorId: user.userId,
    action: 'INDIRECT_FEEDBACK_SAVED',
    entityType: 'Course',
    entityId: courseId,
    before: before.map((row) => ({ co: codeById.get(row.coId) ?? row.coId, n1: row.n1, n2: row.n2, n3: row.n3 })),
    after: parsed.rows
      .filter((row) => !isEmpty(row.counts))
      .map((row) => ({ co: codeById.get(row.coId) ?? row.coId, ...row.counts })),
  });

  revalidatePath(`/courses/${courseId}`, 'layout');
  return {
    ok: true,
    message:
      withFeedback === 0
        ? 'Saved. No feedback recorded, so attainment stays direct-only.'
        : `Saved feedback for ${withFeedback} outcome${withFeedback === 1 ? '' : 's'}. Attainment has been recomputed.`,
  };
}
