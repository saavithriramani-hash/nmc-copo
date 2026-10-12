'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { roleEffectiveAt } from '@copo/auth';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { courseBlockMessage, courseLabel } from '@/lib/catalogueRemoval';
import { offerTargetProblem, planCourseCopy } from '@/lib/courseOffer';

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
 * CR-9: delete a course from the catalogue — the COE, or the
 * administrator. The policy admits a DRAFT course only; this refuses
 * further while any recorded work exists (catalogueRemoval.ts), and
 * otherwise removes the course with the set-up it owns, in one
 * transaction.
 *
 * Race safety: a mark, rating, snapshot or submission written after the
 * count below makes the enrolment or course delete fail on its RESTRICT
 * foreign key, which rolls the whole transaction back; and the course row
 * is deleted only while still DRAFT, so a submission in between is caught
 * too.
 */
export type DeleteCourseResult = { ok?: true; error?: string };

export async function deleteCourseAction(courseId: string, fromCoursePage = false): Promise<DeleteCourseResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.delete', courseId });

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      code: true,
      title: true,
      semester: true,
      credits: true,
      isLaboratory: true,
      batchId: true,
      cos: { select: { code: true, statement: true }, orderBy: { displayOrder: 'asc' } },
      assessments: { select: { name: true, weightGroup: true }, orderBy: { displayOrder: 'asc' } },
      instructors: { select: { userId: true } },
      _count: { select: { enrolments: true, snapshots: true, submissions: true } },
    },
  });
  if (!course) return { error: 'That course no longer exists.' };

  const [marks, learnerRatings] = await Promise.all([
    prisma.markValue.count({ where: { courseId } }),
    prisma.learnerRating.count({ where: { enrolment: { courseId } } }),
  ]);
  const refusal = courseBlockMessage(course, {
    marks,
    learnerRatings,
    snapshots: course._count.snapshots,
    submissions: course._count.submissions,
  });
  if (refusal) return { error: refusal };

  try {
    await prisma.$transaction(async (tx) => {
      const ofCourse = { assessment: { courseId } };
      await tx.assessmentCoTag.deleteMany({ where: ofCourse });
      await tx.item.deleteMany({ where: ofCourse });
      await tx.section.deleteMany({ where: ofCourse });
      await tx.assessment.deleteMany({ where: { courseId } });
      await tx.articulationMatrix.deleteMany({ where: { co: { courseId } } });
      await tx.indirectFeedback.deleteMany({ where: { co: { courseId } } });
      await tx.courseOutcome.deleteMany({ where: { courseId } });
      await tx.enrolment.deleteMany({ where: { courseId } });
      await tx.courseInstructor.deleteMany({ where: { courseId } });
      const { count } = await tx.course.deleteMany({ where: { id: courseId, status: 'DRAFT' } });
      if (count !== 1) throw new CourseChangedError();
    });
  } catch (err) {
    if (err instanceof CourseChangedError || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003')) {
      return { error: `“${courseLabel(course)}” changed while you were deleting it. Reload the page and look again.` };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_DELETED',
    entityType: 'Course',
    entityId: courseId,
    before: {
      batchId: course.batchId,
      code: course.code,
      title: course.title,
      semester: course.semester,
      credits: course.credits?.toString() ?? null,
      isLaboratory: course.isLaboratory,
      cos: course.cos,
      assessments: course.assessments,
      instructorIds: course.instructors.map((i) => i.userId),
      enrolments: course._count.enrolments,
    },
  });
  revalidatePath('/courses');
  // From the course's own page there is nothing left to show: re-rendering
  // it would fail on the missing course, so leave for the catalogue.
  if (fromCoursePage) redirect('/courses');
  return { ok: true };
}

class CourseChangedError extends Error {}

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

/**
 * CR-10: offer this course to another batch of its programme — the next
 * year's intake. Creates a NEW course instance there, DRAFT and unstaffed,
 * with the catalogue entry and the set-up copied (courseOffer.ts says
 * exactly what is and is not), in one transaction. The source is only
 * read, whatever its status.
 *
 * Authority is `course.create` on the target batch's department — the
 * same as creating the course by hand, which is all this saves.
 */
export type OfferCourseResult = { ok?: true; error?: string; newCourseId?: string };

export async function offerCourseToBatchAction(
  sourceCourseId: string,
  _prev: OfferCourseResult | null,
  formData: FormData,
): Promise<OfferCourseResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'course.read', courseId: sourceCourseId });

  const targetBatchId = String(formData.get('batchId') ?? '');
  const target = targetBatchId
    ? await prisma.batch.findUnique({
        where: { id: targetBatchId },
        select: { id: true, name: true, programmeId: true, programme: { select: { departmentId: true } } },
      })
    : null;
  // Asked before the rules below, so a batch the caller may not create
  // courses in is denied identically whether or not it would qualify.
  if (target) {
    await guard.require(user.userId, { type: 'course.create', departmentId: target.programme.departmentId });
  }

  const source = await prisma.course.findUniqueOrThrow({
    where: { id: sourceCourseId },
    select: {
      code: true,
      title: true,
      semester: true,
      credits: true,
      isLaboratory: true,
      batchId: true,
      batch: { select: { programmeId: true } },
      cos: {
        select: {
          id: true,
          code: true,
          statement: true,
          bloomLevels: true,
          displayOrder: true,
          matrixEntries: { select: { poId: true, strength: true } },
        },
      },
      assessments: {
        select: {
          name: true,
          shape: true,
          scoringRule: true,
          weightGroup: true,
          displayOrder: true,
          sections: { select: { id: true, name: true, displayOrder: true, optionalAnswerCount: true } },
          items: {
            select: { label: true, maxMark: true, coId: true, sectionId: true, bloomLevel: true, displayOrder: true },
          },
          coTags: { select: { coId: true } },
        },
      },
    },
  });

  const codeTaken = target
    ? (await prisma.course.count({ where: { batchId: target.id, code: source.code } })) > 0
    : false;
  const problem = offerTargetProblem({
    source: { code: source.code, batchId: source.batchId, programmeId: source.batch.programmeId },
    target,
    codeTaken,
  });
  if (problem || !target) return { error: problem ?? 'Choose a batch.' };

  const plan = planCourseCopy({
    cos: source.cos.map((co) => ({ ...co, matrix: co.matrixEntries })),
    assessments: source.assessments.map((a) => ({
      ...a,
      items: a.items.map((item) => ({ ...item, maxMark: item.maxMark.toString() })),
    })),
  });

  let newCourseId: string;
  try {
    newCourseId = await prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          batchId: target.id,
          code: source.code,
          title: source.title,
          semester: source.semester,
          credits: source.credits,
          isLaboratory: source.isLaboratory,
        },
      });

      const coIds: string[] = [];
      for (const co of plan.cos) {
        const created = await tx.courseOutcome.create({
          data: {
            courseId: course.id,
            code: co.code,
            statement: co.statement,
            bloomLevels: co.bloomLevels,
            displayOrder: co.displayOrder,
          },
        });
        coIds.push(created.id);
      }
      const cells = plan.cos.flatMap((co, index) =>
        co.matrix.map((cell) => ({ coId: coIds[index]!, poId: cell.poId, strength: cell.strength })),
      );
      if (cells.length > 0) await tx.articulationMatrix.createMany({ data: cells });

      for (const assessment of plan.assessments) {
        const created = await tx.assessment.create({
          data: {
            courseId: course.id,
            name: assessment.name,
            shape: assessment.shape,
            scoringRule: assessment.scoringRule,
            weightGroup: assessment.weightGroup,
            displayOrder: assessment.displayOrder,
          },
        });
        const sectionIds: string[] = [];
        for (const section of assessment.sections) {
          const createdSection = await tx.section.create({
            data: {
              assessmentId: created.id,
              name: section.name,
              displayOrder: section.displayOrder,
              optionalAnswerCount: section.optionalAnswerCount,
            },
          });
          sectionIds.push(createdSection.id);
        }
        if (assessment.items.length > 0) {
          await tx.item.createMany({
            data: assessment.items.map((item) => ({
              assessmentId: created.id,
              sectionId: item.sectionIndex === null ? null : sectionIds[item.sectionIndex]!,
              label: item.label,
              maxMark: new Prisma.Decimal(item.maxMark),
              coId: item.coIndex === null ? null : coIds[item.coIndex]!,
              bloomLevel: item.bloomLevel,
              displayOrder: item.displayOrder,
            })),
          });
        }
        if (assessment.coTagIndexes.length > 0) {
          await tx.assessmentCoTag.createMany({
            data: assessment.coTagIndexes.map((index) => ({ assessmentId: created.id, coId: coIds[index]! })),
          });
        }
      }
      return course.id;
    });
  } catch (err) {
    // Another offer of the same code to the same batch won the race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: `${target.name} already has a course ${source.code}. Open that one instead.` };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_OFFERED_TO_BATCH',
    entityType: 'Course',
    entityId: newCourseId,
    after: {
      sourceCourseId,
      batchId: target.id,
      code: source.code,
      title: source.title,
      cos: plan.cos.length,
      assessments: plan.assessments.length,
      matrixCells: plan.cos.reduce((sum, co) => sum + co.matrix.length, 0),
    },
  });
  revalidatePath('/courses');
  return { ok: true, newCourseId };
}
