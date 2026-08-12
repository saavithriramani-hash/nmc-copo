'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { roleEffectiveAt } from '@copo/auth';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';

export async function createCourseAction(formData: FormData): Promise<void> {
  const user = await requireSession();

  const batchId = String(formData.get('batchId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const semester = Number(formData.get('semester'));
  const creditsRaw = String(formData.get('credits') ?? '').trim();
  const instructorId = String(formData.get('instructorId') ?? '');

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { programme: { select: { departmentId: true } } },
  });
  if (!batch) redirect('/courses/new?error=Choose+a+batch');

  // Server-derived department; the Guard decides (HoD of that department).
  await guard.require(user.userId, { type: 'course.create', departmentId: batch.programme.departmentId });

  if (!code || !title || !Number.isInteger(semester) || semester < 1) {
    redirect('/courses/new?error=Code,+title+and+semester+are+required');
  }

  const course = await prisma.course.create({
    data: {
      batchId,
      code,
      title,
      semester,
      credits: creditsRaw === '' ? null : new Prisma.Decimal(creditsRaw),
      ...(instructorId ? { instructors: { create: { userId: instructorId } } } : {}),
    },
  });
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_CREATED',
    entityType: 'Course',
    entityId: course.id,
    after: { batchId, code, title, semester, instructorId: instructorId || null },
  });
  redirect(`/courses/${course.id}`);
}

/**
 * CR-3: the course catalogue belongs to the Controller of Examinations —
 * code, title, semester, credits, and whether this is a practical paper.
 * `course.details.write`, not `course.write`: the rest of the course
 * setup stays with the people teaching it.
 */
export type CourseDetailsResult = { ok?: true; error?: string };

export async function updateCourseDetailsAction(
  courseId: string,
  _prev: CourseDetailsResult | null,
  formData: FormData,
): Promise<CourseDetailsResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.details.write', courseId });

  const before = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { code: true, title: true, semester: true, credits: true, isLaboratory: true },
  });

  const code = String(formData.get('code') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const semester = Number(formData.get('semester'));
  const creditsRaw = String(formData.get('credits') ?? '').trim();
  const isLaboratory = formData.get('isLaboratory') === 'on';
  // Returned, not redirected: a server action that redirects to its own
  // route leaves the content area blank in a production build, so the
  // message would never be seen.
  if (!code || !title || !Number.isInteger(semester) || semester < 1) {
    return { error: 'Code, title and semester are required.' };
  }

  // Flipping the flag hands the external assessment to a different set of
  // people. Doing that while marks are already recorded would silently
  // transfer ownership of somebody's work, so it is refused for as long
  // as any external mark exists — the same rule that stops a batch being
  // deleted while a course depends on it.
  if (isLaboratory !== before.isLaboratory) {
    const externalMarks = await prisma.markValue.count({
      where: { courseId, assessment: { weightGroup: 'external' } },
    });
    if (externalMarks > 0) {
      const target = isLaboratory ? 'the department' : 'the Controller of Examinations';
      return {
        error: `Cannot change this to ${isLaboratory ? 'a laboratory' : 'a theory'} course: ${externalMarks} external mark${
          externalMarks === 1 ? '' : 's'
        } already recorded would pass to ${target}. Clear them first.`,
      };
    }
  }

  await prisma.course.update({
    where: { id: courseId },
    data: {
      code,
      title,
      semester,
      credits: creditsRaw === '' ? null : new Prisma.Decimal(creditsRaw),
      isLaboratory,
    },
  });
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_UPDATED',
    entityType: 'Course',
    entityId: courseId,
    before,
    after: { code, title, semester, credits: creditsRaw || null, isLaboratory },
  });
  revalidatePath(`/courses/${courseId}`);
  return { ok: true };
}

/**
 * Staffing (FR-4) — `course.staff`, the HoD's decision, not the course
 * faculty's. See the policy for why this is not `course.write`.
 */
export async function addInstructorAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.staff', courseId });

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isActive: true, roles: true },
  });
  if (!target || !target.isActive) {
    redirect(`/courses/${courseId}?error=No+active+account+with+that+email`);
  }

  // Listing someone who does not hold FACULTY grants them nothing — the
  // policy's `instructs` predicate requires the role — so the row would
  // only mislead whoever reads the page. Refuse it outright.
  const isFaculty = target.roles.some((role) => role.kind === 'FACULTY' && roleEffectiveAt(role, new Date()));
  if (!isFaculty) {
    redirect(`/courses/${courseId}?error=That+account+does+not+hold+the+Faculty+role,+so+assigning+it+would+grant+no+access`);
  }

  await prisma.courseInstructor.upsert({
    where: { courseId_userId: { courseId, userId: target.id } },
    create: { courseId, userId: target.id },
    update: {},
  });
  await logAudit({
    actorId: user.userId,
    action: 'INSTRUCTOR_ASSIGNED',
    entityType: 'Course',
    entityId: courseId,
    after: { userId: target.id, email },
  });
  revalidatePath(`/courses/${courseId}`);
}

export async function removeInstructorAction(courseId: string, userId: string): Promise<void> {
  const actor = await requireSession();
  await guard.require(actor.userId, { type: 'course.staff', courseId });

  // Removing the last instructor strands the course: no faculty could
  // then enter marks or submit it, and only the HoD could rescue it.
  const remaining = await prisma.courseInstructor.count({ where: { courseId } });
  if (remaining <= 1) {
    redirect(`/courses/${courseId}?error=A+course+must+keep+at+least+one+assigned+faculty+member.+Add+the+replacement+first`);
  }

  // Idempotent: a double submit or a stale page must not raise a 500.
  const { count } = await prisma.courseInstructor.deleteMany({ where: { courseId, userId } });
  if (count === 0) return;
  await logAudit({
    actorId: actor.userId,
    action: 'INSTRUCTOR_REMOVED',
    entityType: 'Course',
    entityId: courseId,
    before: { userId },
  });
  revalidatePath(`/courses/${courseId}`);
}
