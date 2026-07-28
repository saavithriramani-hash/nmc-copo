'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { parseThresholdPercent } from '@/lib/courseThreshold';

/**
 * Course-level parameter overrides (§4, FR-3) — `settings.course.write`.
 *
 * The policy allows this to the HoD of the course's department and to
 * nobody else, and refuses on a LOCKED course. Faculty who own the
 * course cannot set it: a course-level override records an
 * Academic-Council-minuted exception, not a teaching preference.
 *
 * Audit-logged with the prior value (FR-17), because the applied
 * override must be defensible on the course report.
 */

export type ThresholdResult = { error?: string; ok?: boolean; message?: string };

export async function setCourseThresholdAction(courseId: string, raw: string): Promise<ThresholdResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'settings.course.write', courseId });

  const parsed = parseThresholdPercent(raw);
  if ('error' in parsed) return { error: parsed.error };

  const before = await prisma.course.findUnique({
    where: { id: courseId },
    select: { thresholdFraction: true },
  });
  if (!before) return { error: 'That course no longer exists.' };

  const previous = before.thresholdFraction === null ? null : Number(before.thresholdFraction);
  if (previous === parsed.value) {
    return { ok: true, message: 'No change — that is already the setting.' };
  }

  await prisma.course.update({
    where: { id: courseId },
    data: {
      thresholdFraction: parsed.value === null ? null : new Prisma.Decimal(parsed.value),
    },
  });

  await logAudit({
    actorId: user.userId,
    action: parsed.value === null ? 'COURSE_THRESHOLD_CLEARED' : 'COURSE_THRESHOLD_SET',
    entityType: 'Course',
    entityId: courseId,
    before: { thresholdFraction: previous },
    after: { thresholdFraction: parsed.value },
  });

  // Attainment is computed on demand from marks, so the new threshold
  // takes effect immediately everywhere this course is shown.
  revalidatePath(`/courses/${courseId}`, 'layout');

  return {
    ok: true,
    message:
      parsed.value === null
        ? 'Override removed — this course now inherits its threshold again.'
        : 'Saved. This course now uses its own threshold; attainment has been recomputed.',
  };
}
