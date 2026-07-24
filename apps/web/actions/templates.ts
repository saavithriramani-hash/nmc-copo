'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { applyPattern, capturePattern, parsePattern } from '@/lib/setupPlans';
import { requireSession } from '@/lib/session';

async function departmentOfCourse(courseId: string): Promise<string> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { batch: { select: { programme: { select: { departmentId: true } } } } },
  });
  return course.batch.programme.departmentId;
}

/**
 * FR-8, creation path: capture an existing course's assessment structure
 * as a department template. CO tags become CO-order slots.
 */
export async function saveTemplateFromCourseAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  const departmentId = await departmentOfCourse(courseId);
  await guard.require(user.userId, { type: 'templates.manage', departmentId });
  await guard.require(user.userId, { type: 'course.read', courseId });

  const name = String(formData.get('name') ?? '').trim();
  const back = `/courses/${courseId}/assessments`;
  if (!name) redirect(`${back}?error=Give+the+template+a+name`);

  const [cos, assessments] = await Promise.all([
    prisma.courseOutcome.findMany({ where: { courseId }, select: { id: true, displayOrder: true } }),
    prisma.assessment.findMany({
      where: { courseId },
      include: { sections: true, items: true, coTags: true },
    }),
  ]);
  if (assessments.length === 0) redirect(`${back}?error=This+course+has+no+assessments+to+capture`);

  const pattern = capturePattern(
    cos,
    assessments.map((a) => ({
      name: a.name,
      shape: a.shape,
      scoringRule: a.scoringRule,
      weightGroup: a.weightGroup,
      displayOrder: a.displayOrder,
      sections: a.sections,
      items: a.items.map((item) => ({
        label: item.label,
        maxMark: item.maxMark.toString(),
        coId: item.coId,
        sectionId: item.sectionId,
        displayOrder: item.displayOrder,
      })),
      coTags: a.coTags,
    })),
  );

  try {
    const template = await prisma.assessmentTemplate.create({
      data: { departmentId, name, pattern: pattern as unknown as Prisma.InputJsonValue },
    });
    await logAudit({
      actorId: user.userId,
      action: 'TEMPLATE_CREATED',
      entityType: 'AssessmentTemplate',
      entityId: template.id,
      after: { departmentId, name, fromCourseId: courseId, assessments: pattern.assessments.length },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      redirect(`${back}?error=A+template+with+that+name+already+exists+in+the+department`);
    }
    throw err;
  }
  redirect(`${back}?notice=Template+saved`);
}

/**
 * FR-8, adoption: one action creates the template's whole structure on a
 * course — then the faculty member adjusts. Allowed only while the course
 * has no assessments (adoption is a starting point, not a merge).
 */
export async function adoptTemplateAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.write', courseId });

  const templateId = String(formData.get('templateId') ?? '');
  const back = `/courses/${courseId}/assessments`;

  const departmentId = await departmentOfCourse(courseId);
  const template = await prisma.assessmentTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.departmentId !== departmentId) {
    redirect(`${back}?error=Choose+a+template+of+this+department`);
  }
  if ((await prisma.assessment.count({ where: { courseId } })) > 0) {
    redirect(`${back}?error=This+course+already+has+assessments;+adoption+starts+from+an+empty+list`);
  }

  const cos = await prisma.courseOutcome.findMany({ where: { courseId }, orderBy: { displayOrder: 'asc' }, select: { id: true } });
  const pattern = parsePattern(template.pattern);
  const { plans, warnings } = applyPattern(pattern, cos);

  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      const created = await tx.assessment.create({
        data: {
          courseId,
          name: plan.name,
          shape: plan.shape,
          scoringRule: plan.scoringRule,
          weightGroup: plan.weightGroup,
          displayOrder: plan.displayOrder,
          ...(plan.shape === 'SINGLE_SCORE'
            ? {
                items: { create: { label: 'Score', maxMark: new Prisma.Decimal(plan.singleMaxMark ?? 0), displayOrder: 1 } },
                ...(plan.coTagIds.length > 0 ? { coTags: { create: plan.coTagIds.map((coId) => ({ coId })) } } : {}),
              }
            : {}),
        },
      });
      for (const section of plan.sections) {
        const createdSection = await tx.section.create({
          data: { assessmentId: created.id, name: section.name, displayOrder: section.displayOrder },
        });
        if (section.items.length > 0) {
          await tx.item.createMany({
            data: section.items.map((item) => ({
              assessmentId: created.id,
              sectionId: createdSection.id,
              label: item.label,
              maxMark: new Prisma.Decimal(item.maxMark),
              coId: item.coId,
              displayOrder: item.displayOrder,
            })),
          });
        }
      }
      if (plan.items.length > 0) {
        await tx.item.createMany({
          data: plan.items.map((item) => ({
            assessmentId: created.id,
            sectionId: null,
            label: item.label,
            maxMark: new Prisma.Decimal(item.maxMark),
            coId: item.coId,
            displayOrder: item.displayOrder,
          })),
        });
      }
    }
  });

  await logAudit({
    actorId: user.userId,
    action: 'TEMPLATE_ADOPTED',
    entityType: 'Course',
    entityId: courseId,
    after: { templateId, templateName: template.name, assessments: plans.length, warnings },
  });

  const notice = warnings.length > 0 ? encodeURIComponent(warnings.join(' ')) : 'Template+adopted';
  redirect(`${back}?notice=${notice}`);
}

export async function deleteTemplateAction(templateId: string): Promise<void> {
  const user = await requireSession();
  const template = await prisma.assessmentTemplate.findUniqueOrThrow({ where: { id: templateId } });
  await guard.require(user.userId, { type: 'templates.manage', departmentId: template.departmentId });

  await prisma.assessmentTemplate.delete({ where: { id: templateId } });
  await logAudit({
    actorId: user.userId,
    action: 'TEMPLATE_DELETED',
    entityType: 'AssessmentTemplate',
    entityId: templateId,
    before: { name: template.name, departmentId: template.departmentId },
  });
  revalidatePath('/templates');
}
