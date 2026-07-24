'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
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

export async function updateCourseDetailsAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.write', courseId });

  const before = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { code: true, title: true, semester: true, credits: true },
  });

  const code = String(formData.get('code') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const semester = Number(formData.get('semester'));
  const creditsRaw = String(formData.get('credits') ?? '').trim();
  if (!code || !title || !Number.isInteger(semester) || semester < 1) {
    redirect(`/courses/${courseId}?error=Code,+title+and+semester+are+required`);
  }

  await prisma.course.update({
    where: { id: courseId },
    data: { code, title, semester, credits: creditsRaw === '' ? null : new Prisma.Decimal(creditsRaw) },
  });
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_UPDATED',
    entityType: 'Course',
    entityId: courseId,
    before,
    after: { code, title, semester, credits: creditsRaw || null },
  });
  revalidatePath(`/courses/${courseId}`);
}

export async function addInstructorAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.write', courseId });

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const target = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  if (!target || !target.isActive) {
    redirect(`/courses/${courseId}?error=No+active+account+with+that+email`);
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
  await guard.require(actor.userId, { type: 'course.write', courseId });

  await prisma.courseInstructor.delete({ where: { courseId_userId: { courseId, userId } } });
  await logAudit({
    actorId: actor.userId,
    action: 'INSTRUCTOR_REMOVED',
    entityType: 'Course',
    entityId: courseId,
    before: { userId },
  });
  revalidatePath(`/courses/${courseId}`);
}
