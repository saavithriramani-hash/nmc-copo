'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { EXTERNAL_WEIGHT_GROUP, guard, requireAssessmentWrite } from '@/lib/authz';
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
  const courseDepartmentId = await departmentOfCourse(courseId);
  await guard.require(user.userId, { type: 'course.read', courseId });

  /**
   * CR-3. "All departments" publishes the examination pattern the whole
   * college adopts, which only the COE may do; anything else is a
   * department's own pattern, captured by its HoD.
   */
  const institutionWide = String(formData.get('scope') ?? '') === 'institution';
  const departmentId = institutionWide ? null : courseDepartmentId;
  await requireTemplateWrite(user.userId, departmentId);

  const name = String(formData.get('name') ?? '').trim();
  const back = `/courses/${courseId}/assessments`;
  if (!name) redirect(`${back}?error=Give+the+template+a+name`);

  const [cos, allAssessments] = await Promise.all([
    prisma.courseOutcome.findMany({ where: { courseId }, select: { id: true, displayOrder: true } }),
    prisma.assessment.findMany({
      where: { courseId },
      include: { sections: true, items: true, coTags: true },
    }),
  ]);

  /**
   * An institution-wide template carries the EXTERNAL assessment only.
   *
   * The COE publishes an examination pattern, not a whole course: every
   * department sets its own internal tests, assignments and seminars, and
   * dropping one department's idea of those onto every course in the
   * college is not what "adopt the external pattern" should mean. It also
   * keeps adoption within one authority, so an HoD adopting it is never
   * refused half-way through a mixed pattern.
   */
  const assessments = institutionWide
    ? allAssessments.filter((a) => a.weightGroup === EXTERNAL_WEIGHT_GROUP)
    : allAssessments;
  if (assessments.length === 0) {
    redirect(
      `${back}?error=${encodeURIComponent(
        institutionWide
          ? 'This course has no external assessment to capture. An institution-wide template carries the end-semester paper only.'
          : 'This course has no assessments to capture',
      )}`,
    );
  }

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
      redirect(
        `${back}?error=${encodeURIComponent(
          institutionWide
            ? `An institution-wide template called “${name}” already exists.`
            : `A template called “${name}” already exists in this department.`,
        )}`,
      );
    }
    throw err;
  }
  redirect(`${back}?notice=${encodeURIComponent(institutionWide ? 'Template saved for all departments' : 'Template saved')}`);
}

/**
 * FR-8, adoption: one action creates the template's whole structure on a
 * course — then the faculty member adjusts. Allowed only while the course
 * has no assessments (adoption is a starting point, not a merge).
 */
export async function adoptTemplateAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();

  const templateId = String(formData.get('templateId') ?? '');
  const back = `/courses/${courseId}/assessments`;

  const departmentId = await departmentOfCourse(courseId);
  const template = await prisma.assessmentTemplate.findUnique({ where: { id: templateId } });
  // Either this department's own pattern, or an institution-wide one the
  // COE published for everybody (CR-3).
  if (!template || (template.departmentId !== null && template.departmentId !== departmentId)) {
    redirect(`${back}?error=Choose+a+template+of+this+department`);
  }
  if ((await prisma.assessment.count({ where: { courseId } })) > 0) {
    redirect(`${back}?error=This+course+already+has+assessments;+adoption+starts+from+an+empty+list`);
  }

  const cos = await prisma.courseOutcome.findMany({ where: { courseId }, orderBy: { displayOrder: 'asc' }, select: { id: true } });
  const pattern = parsePattern(template.pattern);
  const { plans, warnings } = applyPattern(pattern, cos);

  // CR-3: adoption CREATES assessments, so it needs the same permission
  // creating each one by hand would. A pattern of internal tests is the
  // department's to apply; one carrying the end-semester paper is the
  // examinations office's. Checked per assessment, before anything is
  // written, so a mixed pattern is refused whole rather than half-applied.
  for (const plan of plans) {
    await requireAssessmentWrite(user.userId, courseId, plan.weightGroup);
  }

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

/**
 * CR-3: a template with no department is the institution-wide external
 * examination pattern, which belongs to the Controller of Examinations.
 * A departmental one (FR-8) stays with that department's HoD.
 */
async function requireTemplateWrite(userId: string, departmentId: string | null): Promise<void> {
  if (departmentId === null) {
    await guard.require(userId, { type: 'templates.institution.manage' });
    return;
  }
  await guard.require(userId, { type: 'templates.manage', departmentId });
}

export async function deleteTemplateAction(templateId: string): Promise<void> {
  const user = await requireSession();
  const template = await prisma.assessmentTemplate.findUniqueOrThrow({ where: { id: templateId } });
  await requireTemplateWrite(user.userId, template.departmentId);

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
