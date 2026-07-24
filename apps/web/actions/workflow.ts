'use server';

import { revalidatePath } from 'next/cache';
import { ENGINE_VERSION } from '@copo/engine';
import type { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { computeLive } from '@/lib/compute';
import { warningsFingerprint } from '@/lib/versionDiff';
import { requireSession } from '@/lib/session';

/**
 * The approval workflow (FR-16): faculty submits → HoD reviews and locks
 * → an immutable versioned snapshot. Unlocking creates a new version;
 * nothing is ever overwritten. Every transition is audit-logged with the
 * prior value (FR-17).
 */

export async function submitCourseAction(courseId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.submit', courseId });

  const before = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { status: true } });
  await prisma.course.update({ where: { id: courseId }, data: { status: 'SUBMITTED' } });
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_SUBMITTED',
    entityType: 'Course',
    entityId: courseId,
    before: { status: before.status },
    after: { status: 'SUBMITTED' },
  });
  revalidatePath(`/courses/${courseId}`, 'layout');
  return { ok: true };
}

/**
 * Locks a course: recomputes from the marks as they stand, refuses if
 * warnings remain unacknowledged, and writes the immutable snapshot —
 * the engine input, the full result, the parameters in force, and the
 * engine version, so an auditor can replay the exact computation.
 *
 * `acknowledgedFingerprint` is the fingerprint the HoD saw when they
 * ticked the warnings. If the marks changed since, the recomputed
 * fingerprint differs and the lock is refused — you cannot acknowledge
 * one set of warnings and lock another.
 */
export async function lockCourseAction(
  courseId: string,
  acknowledgedFingerprint: string | null,
): Promise<{ ok: boolean; error?: string; version?: number }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.lock', courseId });

  const attainment = await computeLive(courseId);
  const warnings = attainment.result.warnings;
  const fingerprint = warningsFingerprint(warnings);

  if (warnings.length > 0) {
    if (acknowledgedFingerprint === null) {
      return { ok: false, error: `This course computed with ${warnings.length} warning(s). Review and acknowledge them before locking.` };
    }
    if (acknowledgedFingerprint !== fingerprint) {
      return {
        ok: false,
        error: 'The marks or setup changed since you reviewed the warnings. Re-read the current warnings and acknowledge again.',
      };
    }
  }

  const last = await prisma.attainmentSnapshot.findFirst({
    where: { courseId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  await prisma.$transaction(async (tx) => {
    await tx.attainmentSnapshot.create({
      data: {
        courseId,
        version,
        engineVersion: ENGINE_VERSION,
        input: attainment.input as unknown as Prisma.InputJsonValue,
        // The result travels with the display maps so a snapshot renders
        // years later even if COs, items or students were since renamed.
        result: {
          result: attainment.result,
          refs: attainment.refs,
          acknowledgedWarnings: warnings.length,
          warningsFingerprint: fingerprint,
        } as unknown as Prisma.InputJsonValue,
        createdById: user.userId,
      },
    });
    await tx.course.update({ where: { id: courseId }, data: { status: 'LOCKED' } });
  });

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_LOCKED',
    entityType: 'Course',
    entityId: courseId,
    before: { status: 'SUBMITTED' },
    after: { status: 'LOCKED', version, engineVersion: ENGINE_VERSION, warningsAcknowledged: warnings.length },
  });
  revalidatePath(`/courses/${courseId}`, 'layout');
  return { ok: true, version };
}

/**
 * Unlocking returns the course to DRAFT for correction. The existing
 * snapshot is untouched — the database trigger forbids updating or
 * deleting it — so re-locking later writes version n+1 beside it.
 */
export async function unlockCourseAction(courseId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.unlock', courseId });
  if (reason.trim().length < 5) return { ok: false, error: 'Give a reason for unlocking (it is recorded in the audit log).' };

  await prisma.course.update({ where: { id: courseId }, data: { status: 'DRAFT' } });
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_UNLOCKED',
    entityType: 'Course',
    entityId: courseId,
    before: { status: 'LOCKED' },
    after: { status: 'DRAFT', reason: reason.trim() },
  });
  revalidatePath(`/courses/${courseId}`, 'layout');
  return { ok: true };
}
