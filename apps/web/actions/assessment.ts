'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { AuthzDeniedError } from '@copo/auth';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard, requireAssessmentWrite } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { isBloomLevel } from '@/lib/bloom';
import { resolveCourseParameters } from '@/lib/params';
import { requireSession } from '@/lib/session';

export async function createAssessmentAction(courseId: string, formData: FormData): Promise<void> {
  const user = await requireSession();
  // Authorised BELOW, once the weight group is known: CR-3 makes the
  // external examination the COE's on a theory paper and the
  // department's on a practical one.

  const name = String(formData.get('name') ?? '').trim();
  const shape = String(formData.get('shape') ?? '') as 'SECTIONED' | 'ITEM_LIST' | 'SINGLE_SCORE';
  const scoringRule = String(formData.get('scoringRule') ?? 'RUBRIC') as 'RUBRIC' | 'COHORT_BAND';
  const weightGroup = String(formData.get('weightGroup') ?? '');
  const maxMarkRaw = String(formData.get('maxMark') ?? '').trim();

  const back = `/courses/${courseId}/assessments`;
  if (!name) redirect(`${back}?error=Name+is+required`);
  if (!['SECTIONED', 'ITEM_LIST', 'SINGLE_SCORE'].includes(shape)) redirect(`${back}?error=Choose+a+shape`);
  if (scoringRule === 'COHORT_BAND' && shape !== 'SINGLE_SCORE') {
    redirect(`${back}?error=Cohort-band+scoring+applies+to+a+single+total+score+only`);
  }
  const { parameters } = await resolveCourseParameters(courseId);
  if (!(weightGroup in parameters.weightGroups)) redirect(`${back}?error=Choose+a+weight+group`);
  // A denial here is a normal outcome, not a fault: the form no longer
  // offers a group the caller cannot write, so reaching this means a
  // stale page or a hand-made request. Either way it deserves a sentence
  // rather than the blank error page an uncaught AuthzDeniedError gives.
  // The guard still records the denial before it is caught.
  try {
    await requireAssessmentWrite(user.userId, courseId, weightGroup);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect(
        `${back}?error=${encodeURIComponent(
          `The “${weightGroup}” group is not yours to add to. On a theory course the end-semester examination is set by the Controller of Examinations; marking the course as Laboratory hands its practical examination to the department.`,
        )}`,
      );
    }
    throw err;
  }
  const maxMark = Number(maxMarkRaw);
  if (shape === 'SINGLE_SCORE' && (!Number.isFinite(maxMark) || maxMark <= 0)) {
    redirect(`${back}?error=A+single-score+assessment+needs+its+maximum+mark`);
  }

  const displayOrder = (await prisma.assessment.count({ where: { courseId } })) + 1;
  const assessment = await prisma.assessment.create({
    data: {
      courseId,
      name,
      shape,
      scoringRule,
      weightGroup,
      displayOrder,
      ...(shape === 'SECTIONED'
        ? { sections: { create: { name: 'Section A', displayOrder: 1 } } }
        : {}),
      ...(shape === 'SINGLE_SCORE'
        ? { items: { create: { label: 'Score', maxMark: new Prisma.Decimal(maxMark), displayOrder: 1 } } }
        : {}),
    },
  });
  await logAudit({
    actorId: user.userId,
    action: 'ASSESSMENT_CREATED',
    entityType: 'Assessment',
    entityId: assessment.id,
    after: { courseId, name, shape, scoringRule, weightGroup },
  });
  redirect(`/courses/${courseId}/assessments/${assessment.id}`);
}

export async function deleteAssessmentAction(courseId: string, assessmentId: string): Promise<void> {
  const user = await requireSession();

  const before = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { _count: { select: { items: true, sections: true } } },
  });
  if (before.courseId !== courseId) redirect(`/courses/${courseId}/assessments?error=Assessment+mismatch`);
  try {
    await requireAssessmentWrite(user.userId, courseId, before.weightGroup);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect(
        `/courses/${courseId}/assessments?error=${encodeURIComponent(
          'That assessment is not yours to delete. On a theory course the end-semester examination belongs to the Controller of Examinations.',
        )}`,
      );
    }
    throw err;
  }

  try {
    await prisma.$transaction([
      prisma.assessmentCoTag.deleteMany({ where: { assessmentId } }),
      prisma.item.deleteMany({ where: { assessmentId } }),
      prisma.section.deleteMany({ where: { assessmentId } }),
      prisma.assessment.delete({ where: { id: assessmentId } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      redirect(`/courses/${courseId}/assessments?error=Marks+are+already+entered+against+this+assessment;+it+cannot+be+deleted`);
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'ASSESSMENT_DELETED',
    entityType: 'Assessment',
    entityId: assessmentId,
    before: { courseId, name: before.name, shape: before.shape },
  });
  revalidatePath(`/courses/${courseId}/assessments`);
  redirect(`/courses/${courseId}/assessments`);
}

// ── full-structure save from the editor ─────────────────────────────────

export interface StructureItemInput {
  id: string | null;
  label: string;
  maxMark: number;
  coId: string | null;
  /**
   * CR-7: the knowledge level this question examines. Null = untagged,
   * and left out of the learning-outcome report. Optional on the wire so
   * a caller written before CR-7 still saves a valid structure.
   */
  bloomLevel?: string | null;
}
export interface StructureSectionInput {
  id: string | null;
  name: string;
  /** §3.1 "answer any n of m"; null = all questions compulsory. */
  optionalAnswerCount: number | null;
  items: StructureItemInput[];
}
export interface StructurePayload {
  name: string;
  weightGroup: string;
  scoringRule: 'RUBRIC' | 'COHORT_BAND';
  sections?: StructureSectionInput[];
  items?: StructureItemInput[];
  single?: { maxMark: number; coTagIds: string[] };
}

export async function saveAssessmentStructureAction(
  assessmentId: string,
  payload: StructurePayload,
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireSession();

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: { sections: true, items: true, coTags: true },
  });
  if (!assessment) return { error: 'Assessment not found.' };
  const courseId = assessment.courseId;
  // Both the group it is in NOW and the group it is being moved to: an
  // editor may neither take an external paper out of the COE's hands nor
  // push one of their own into them. This action returns its errors, so a
  // denial is returned too rather than thrown at a blank page.
  try {
    await requireAssessmentWrite(user.userId, courseId, assessment.weightGroup);
    await requireAssessmentWrite(user.userId, courseId, payload.weightGroup);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return {
        error:
          'This assessment is not yours to edit. On a theory course the end-semester examination belongs to the Controller of Examinations.',
      };
    }
    throw err;
  }

  // ── validation ──
  if (!payload.name.trim()) return { error: 'The assessment needs a name.' };
  if (payload.scoringRule === 'COHORT_BAND' && assessment.shape !== 'SINGLE_SCORE') {
    return { error: 'Cohort-band scoring applies to a single total score only.' };
  }
  const { parameters } = await resolveCourseParameters(courseId);
  if (!(payload.weightGroup in parameters.weightGroups)) {
    return { error: `Unknown weight group '${payload.weightGroup}'. Groups: ${Object.keys(parameters.weightGroups).join(', ')}.` };
  }
  const courseCos = await prisma.courseOutcome.findMany({ where: { courseId }, select: { id: true } });
  const coIds = new Set(courseCos.map((co) => co.id));

  const allItems: StructureItemInput[] =
    assessment.shape === 'SECTIONED'
      ? (payload.sections ?? []).flatMap((section) => section.items)
      : assessment.shape === 'ITEM_LIST'
        ? (payload.items ?? [])
        : [];
  for (const item of allItems) {
    if (!item.label.trim()) return { error: 'Every item needs a label.' };
    if (!Number.isFinite(item.maxMark) || item.maxMark <= 0) return { error: `Item '${item.label}': maximum mark must be positive.` };
    if (item.coId !== null && !coIds.has(item.coId)) return { error: `Item '${item.label}': unknown CO tag.` };
    // Checked here as well as by the database CHECK, so a mistyped level
    // is a sentence the faculty can act on rather than a constraint
    // violation surfacing as a server error.
    if (item.bloomLevel != null && !isBloomLevel(item.bloomLevel)) {
      return { error: `Item '${item.label}': '${item.bloomLevel}' is not a knowledge level.` };
    }
  }
  const labels = allItems.map((item) => item.label.trim());
  if (new Set(labels).size !== labels.length) return { error: 'Item labels must be unique within the assessment.' };
  if (assessment.shape === 'SECTIONED') {
    const names = (payload.sections ?? []).map((section) => section.name.trim());
    if (names.some((name) => !name)) return { error: 'Every section needs a name.' };
    if (new Set(names).size !== names.length) return { error: 'Section names must be unique.' };
    if ((payload.sections ?? []).length === 0) return { error: 'A sectioned assessment needs at least one section.' };
    for (const section of payload.sections ?? []) {
      const n = section.optionalAnswerCount;
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > section.items.length)) {
        return { error: `Section “${section.name}”: “answer any n” must be between 1 and its ${section.items.length} question(s), or blank for all compulsory.` };
      }
    }
  }
  if (assessment.shape === 'SINGLE_SCORE') {
    if (!payload.single || !Number.isFinite(payload.single.maxMark) || payload.single.maxMark <= 0) {
      return { error: 'The maximum mark must be positive.' };
    }
    for (const coId of payload.single.coTagIds) {
      if (!coIds.has(coId)) return { error: 'Unknown CO tag.' };
    }
  }

  // ── reconcile, transactionally ──
  try {
    await prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id: assessmentId },
        data: { name: payload.name.trim(), weightGroup: payload.weightGroup, scoringRule: payload.scoringRule },
      });

      if (assessment.shape === 'SINGLE_SCORE') {
        const single = assessment.items[0];
        if (!single) throw new Error('single-score assessment has no item row');
        await tx.item.update({ where: { id: single.id }, data: { maxMark: new Prisma.Decimal(payload.single!.maxMark) } });
        await tx.assessmentCoTag.deleteMany({ where: { assessmentId } });
        if (payload.single!.coTagIds.length > 0) {
          await tx.assessmentCoTag.createMany({ data: payload.single!.coTagIds.map((coId) => ({ assessmentId, coId })) });
        }
        return;
      }

      const keptItemIds = new Set(allItems.filter((item) => item.id).map((item) => item.id as string));
      for (const existing of assessment.items) {
        if (!keptItemIds.has(existing.id)) await tx.item.delete({ where: { id: existing.id } });
      }

      if (assessment.shape === 'SECTIONED') {
        const keptSectionIds = new Set((payload.sections ?? []).filter((s) => s.id).map((s) => s.id as string));
        for (const existing of assessment.sections) {
          if (!keptSectionIds.has(existing.id)) await tx.section.delete({ where: { id: existing.id } });
        }
        for (const [sectionIndex, section] of (payload.sections ?? []).entries()) {
          const sectionData = {
            name: section.name.trim(),
            displayOrder: sectionIndex + 1,
            optionalAnswerCount: section.optionalAnswerCount,
          };
          let sectionId = section.id;
          if (sectionId) {
            await tx.section.update({ where: { id: sectionId }, data: sectionData });
          } else {
            const created = await tx.section.create({ data: { assessmentId, ...sectionData } });
            sectionId = created.id;
          }
          for (const [itemIndex, item] of section.items.entries()) {
            const data = {
              label: item.label.trim(),
              maxMark: new Prisma.Decimal(item.maxMark),
              coId: item.coId,
              bloomLevel: item.bloomLevel ?? null,
              sectionId,
              displayOrder: itemIndex + 1,
            };
            if (item.id) await tx.item.update({ where: { id: item.id }, data });
            else await tx.item.create({ data: { ...data, assessmentId } });
          }
        }
      } else {
        for (const [itemIndex, item] of (payload.items ?? []).entries()) {
          const data = {
            label: item.label.trim(),
            maxMark: new Prisma.Decimal(item.maxMark),
            coId: item.coId,
            bloomLevel: item.bloomLevel ?? null,
            displayOrder: itemIndex + 1,
          };
          if (item.id) await tx.item.update({ where: { id: item.id }, data });
          else await tx.item.create({ data: { ...data, assessmentId, sectionId: null } });
        }
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return { error: 'Marks are already entered against a removed item; clear them first.' };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'ASSESSMENT_STRUCTURE_SAVED',
    entityType: 'Assessment',
    entityId: assessmentId,
    before: {
      name: assessment.name,
      weightGroup: assessment.weightGroup,
      sections: assessment.sections.length,
      items: assessment.items.length,
    },
    after: {
      name: payload.name,
      weightGroup: payload.weightGroup,
      sections: payload.sections?.length ?? 0,
      items: allItems.length || (assessment.shape === 'SINGLE_SCORE' ? 1 : 0),
    },
  });
  revalidatePath(`/courses/${courseId}/assessments`, 'layout');
  return { ok: true };
}
