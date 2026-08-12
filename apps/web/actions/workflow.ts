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
  // Status and round move together: a SUBMITTED course with no round
  // open would be invisible to the HoD's queue, which is built from the
  // rounds rather than from the status.
  await prisma.$transaction([
    prisma.course.update({ where: { id: courseId }, data: { status: 'SUBMITTED' } }),
    prisma.courseSubmission.create({ data: { courseId, submittedById: user.userId } }),
  ]);
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_SUBMITTED',
    entityType: 'Course',
    entityId: courseId,
    before: { status: before.status },
    after: { status: 'SUBMITTED' },
  });
  revalidatePath(`/courses/${courseId}`, 'layout');
  revalidatePath('/');
  return { ok: true };
}

/**
 * FR-16, the other outcome of a review: send the submission back with
 * the reason it was not approved.
 *
 * The workflow had no such move — a HoD could approve or say nothing, so
 * "please fix the CO tags" happened outside the system and left no
 * trace. The reason is required, recorded on the round, and never edited
 * afterwards: it is part of how the course eventually came to be
 * approved.
 *
 * The course goes back to DRAFT so its faculty can actually act on the
 * note; while SUBMITTED they are frozen out by design.
 */
export async function returnCourseAction(
  courseId: string,
  comment: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.return', courseId });

  const reason = comment.trim();
  if (reason.length < 5) {
    return { ok: false, error: 'Say what needs changing — the faculty member sees this, and it is kept with the course.' };
  }

  const round = await prisma.courseSubmission.findFirst({
    where: { courseId, resolution: 'PENDING' },
    orderBy: { submittedAt: 'desc' },
  });

  await prisma.$transaction([
    prisma.course.update({ where: { id: courseId }, data: { status: 'DRAFT' } }),
    // A course submitted before review rounds existed has none open, so
    // one is written now rather than losing the fact that it was
    // returned. `submittedById` falls back to the returner because the
    // original submitter is unknowable at this point.
    round
      ? prisma.courseSubmission.update({
          where: { id: round.id },
          data: { resolution: 'RETURNED', resolvedById: user.userId, resolvedAt: new Date(), returnComment: reason },
        })
      : prisma.courseSubmission.create({
          data: {
            courseId,
            submittedById: user.userId,
            resolution: 'RETURNED',
            resolvedById: user.userId,
            resolvedAt: new Date(),
            returnComment: reason,
          },
        }),
  ]);

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_RETURNED',
    entityType: 'Course',
    entityId: courseId,
    before: { status: 'SUBMITTED' },
    after: { status: 'DRAFT', comment: reason },
  });
  revalidatePath(`/courses/${courseId}`, 'layout');
  revalidatePath('/');
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

    // Close the review round, tying it to the version it produced, so
    // the history reads "submitted, approved, version 2" rather than
    // leaving a round open for ever.
    const round = await tx.courseSubmission.findFirst({
      where: { courseId, resolution: 'PENDING' },
      orderBy: { submittedAt: 'desc' },
      select: { id: true },
    });
    if (round) {
      await tx.courseSubmission.update({
        where: { id: round.id },
        data: { resolution: 'APPROVED', resolvedById: user.userId, resolvedAt: new Date(), approvedVersion: version },
      });
    } else {
      // A HoD may submit and lock in one sitting, and courses locked
      // before rounds existed have none. Record the round anyway so
      // every approval has a review behind it in the file.
      await tx.courseSubmission.create({
        data: {
          courseId,
          submittedById: user.userId,
          resolution: 'APPROVED',
          resolvedById: user.userId,
          resolvedAt: new Date(),
          approvedVersion: version,
        },
      });
    }
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
  revalidatePath('/');
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
