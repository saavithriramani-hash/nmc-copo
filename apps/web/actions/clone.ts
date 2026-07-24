'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { applyPattern, capturePattern } from '@/lib/setupPlans';
import { requireSession } from '@/lib/session';

/**
 * FR-9: clone a full course setup — COs, articulation matrix, assessments
 * — from a previous batch or another course. Never marks, never
 * enrolments, never parameter overrides (a minuted exception belongs to
 * one course only). The matrix copies only within the same programme,
 * because PO/PSO ids differ across programmes; otherwise it is skipped
 * with an explicit notice.
 */
export async function cloneCourseSetupAction(targetCourseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  const sourceCourseId = String(formData.get('sourceCourseId') ?? '');
  const back = `/courses/${targetCourseId}/assessments`;

  await guard.require(user.userId, { type: 'course.write', courseId: targetCourseId });
  await guard.require(user.userId, { type: 'course.read', courseId: sourceCourseId });

  const [target, source] = await Promise.all([
    prisma.course.findUniqueOrThrow({
      where: { id: targetCourseId },
      include: { batch: true, _count: { select: { cos: true, assessments: true } } },
    }),
    prisma.course.findUniqueOrThrow({
      where: { id: sourceCourseId },
      include: {
        batch: true,
        cos: { orderBy: { displayOrder: 'asc' }, include: { matrixEntries: true } },
        assessments: { include: { sections: true, items: true, coTags: true } },
      },
    }),
  ]);

  if (target._count.cos > 0 || target._count.assessments > 0) {
    redirect(`${back}?error=Cloning+needs+an+empty+course+(no+COs,+no+assessments)`);
  }
  if (source.cos.length === 0) {
    redirect(`${back}?error=The+source+course+has+no+COs+to+clone`);
  }

  const sameProgramme = source.batch.programmeId === target.batch.programmeId;
  const pattern = capturePattern(
    source.cos,
    source.assessments.map((a) => ({
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

  await prisma.$transaction(async (tx) => {
    // 1. COs, same order — slot i of the pattern is CO i here by construction.
    const newCoIds: string[] = [];
    for (const co of source.cos) {
      const created = await tx.courseOutcome.create({
        data: {
          courseId: targetCourseId,
          code: co.code,
          statement: co.statement,
          bloomLevel: co.bloomLevel,
          displayOrder: co.displayOrder,
        },
      });
      newCoIds.push(created.id);
    }

    // 2. Matrix — only within the same programme (same PO/PSO ids).
    if (sameProgramme) {
      const cells = source.cos.flatMap((co, index) =>
        co.matrixEntries.map((cell) => ({ coId: newCoIds[index]!, poId: cell.poId, strength: cell.strength })),
      );
      if (cells.length > 0) await tx.articulationMatrix.createMany({ data: cells });
    }

    // 3. Assessments via the same plan machinery templates use.
    const { plans } = applyPattern(pattern, newCoIds.map((id) => ({ id })));
    for (const plan of plans) {
      const created = await tx.assessment.create({
        data: {
          courseId: targetCourseId,
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
    action: 'COURSE_SETUP_CLONED',
    entityType: 'Course',
    entityId: targetCourseId,
    after: {
      sourceCourseId,
      cos: source.cos.length,
      assessments: source.assessments.length,
      matrixCopied: sameProgramme,
    },
  });

  redirect(
    sameProgramme
      ? `${back}?notice=Setup+cloned+from+${encodeURIComponent(source.code)}`
      : `${back}?notice=Setup+cloned;+the+articulation+matrix+was+skipped+because+the+programmes+differ`,
  );
}
