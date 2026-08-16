'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { DEFAULT_LEARNER_CRITERIA } from '@copo/engine';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { parseBands } from '@/lib/learnerBands';
import { requireSession } from '@/lib/session';

/**
 * Slow and advanced learners (CR-8) — the writes.
 *
 * Two surfaces: the teacher's judgements on their own course, and the
 * HoD's setup of what is judged and where the categories fall. Nothing
 * derived is written by either — the weightage and the category are
 * computed on demand (§9).
 */

export interface RatingInput {
  enrolmentId: string;
  criterionId: string;
  /** null = not rated. Emphatically not zero; see learnerCategories.ts. */
  score: number | null;
}

// ── the teacher's judgements ──────────────────────────────────────────────

/**
 * Autosave a batch of edited ratings, on the same pattern as mark entry.
 *
 * Every rating is re-validated against the database — enrolment ∈ course,
 * criterion ∈ the course's programme, score ∈ [0, max] or blank — because
 * the payload comes from a client-side grid.
 */
export async function saveLearnerRatingsAction(
  courseId: string,
  ratings: RatingInput[],
): Promise<{ ok: boolean; savedAt?: string; error?: string; rejected?: string[] }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'learners.rate', courseId });

  if (ratings.length === 0) return { ok: true, savedAt: new Date().toISOString() };

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { batch: { select: { programmeId: true } } },
  });
  if (!course) return { ok: false, error: 'Course not found.' };

  const [criteria, enrolments] = await Promise.all([
    prisma.learnerCriterion.findMany({
      where: { programmeId: course.batch.programmeId },
      select: { id: true, maxScore: true, derived: true },
    }),
    prisma.enrolment.findMany({ where: { courseId }, select: { id: true } }),
  ]);
  const byCriterion = new Map(criteria.map((c) => [c.id, c]));
  const enrolmentIds = new Set(enrolments.map((e) => e.id));

  const rejected: string[] = [];
  const valid: RatingInput[] = [];
  for (const rating of ratings) {
    const criterion = byCriterion.get(rating.criterionId);
    const key = `${rating.enrolmentId}:${rating.criterionId}`;
    // A derived criterion is computed from the mark ledger; storing a
    // typed value for it would create a second, divergent truth.
    if (!criterion || criterion.derived || !enrolmentIds.has(rating.enrolmentId)) {
      rejected.push(key);
      continue;
    }
    const max = Number(criterion.maxScore);
    if (rating.score !== null && (!Number.isFinite(rating.score) || rating.score < 0 || rating.score > max)) {
      rejected.push(key);
      continue;
    }
    valid.push(rating);
  }

  if (valid.length > 0) {
    await prisma.$transaction(
      valid.map((rating) =>
        prisma.learnerRating.upsert({
          where: {
            enrolmentId_criterionId: { enrolmentId: rating.enrolmentId, criterionId: rating.criterionId },
          },
          create: { enrolmentId: rating.enrolmentId, criterionId: rating.criterionId, score: rating.score },
          update: { score: rating.score },
        }),
      ),
    );
  }

  // Not audit-logged per cell, for the same reason mark entry is not:
  // high volume, and the report is recomputed from the rows themselves.
  revalidatePath(`/courses/${courseId}/learners`);
  return {
    ok: rejected.length === 0,
    savedAt: new Date().toISOString(),
    ...(rejected.length > 0 ? { error: `${rejected.length} rating(s) rejected by validation`, rejected } : {}),
  };
}

// ── what is judged, and where the categories fall ─────────────────────────

export interface CriterionInput {
  /** Absent for a new criterion. */
  id?: string;
  label: string;
  maxScore: number;
  derived: boolean;
}

/**
 * Replace a programme's criteria.
 *
 * Criteria already rated against are UPDATED rather than replaced, so a
 * label correction does not silently discard a term's judgements. One
 * that has ratings cannot be removed at all — the request is refused and
 * says so, rather than deleting a teacher's work to satisfy a form.
 */
export async function saveLearnerCriteriaAction(
  programmeId: string,
  criteria: CriterionInput[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'learners.configure', programmeId });

  const cleaned = criteria
    .map((c) => ({ ...c, label: c.label.trim() }))
    .filter((c) => c.label !== '');
  if (cleaned.length === 0) return { ok: false, error: 'Add at least one criterion.' };
  for (const c of cleaned) {
    if (!Number.isFinite(c.maxScore) || c.maxScore <= 0) {
      return { ok: false, error: `“${c.label}” needs a maximum above zero.` };
    }
  }
  const labels = cleaned.map((c) => c.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return { ok: false, error: 'Two criteria have the same name.' };
  if (cleaned.filter((c) => c.derived).length > 1) {
    return { ok: false, error: 'Only one criterion can be derived from the marks.' };
  }

  const existing = await prisma.learnerCriterion.findMany({
    where: { programmeId },
    select: { id: true, label: true, _count: { select: { ratings: true } } },
  });
  const keep = new Set(cleaned.map((c) => c.id).filter(Boolean) as string[]);
  const doomed = existing.filter((e) => !keep.has(e.id));
  const rated = doomed.filter((e) => e._count.ratings > 0);
  if (rated.length > 0) {
    return {
      ok: false,
      error: `${rated.length} criterion/criteria already carry ratings and cannot be removed. Clear their ratings first if you really mean to drop them.`,
    };
  }

  // Lowering a maximum below a rating already entered against it would
  // leave rows the engine refuses — it throws on a rating outside
  // 0..maxScore, which would take the whole classification page down
  // rather than showing a bad figure. Refused here, where it can be
  // explained, instead of being discovered as a broken report.
  const lowering = cleaned.filter((c) => c.id && existing.some((e) => e.id === c.id));
  if (lowering.length > 0) {
    const highest = await prisma.learnerRating.groupBy({
      by: ['criterionId'],
      where: { criterionId: { in: lowering.map((c) => c.id!) } },
      _max: { score: true },
    });
    const byId = new Map(highest.map((h) => [h.criterionId, Number(h._max.score ?? 0)]));
    for (const criterion of lowering) {
      const top = byId.get(criterion.id!);
      if (top !== undefined && top > criterion.maxScore) {
        return {
          ok: false,
          error: `“${criterion.label}” already carries a rating of ${top}, so its maximum cannot be lowered to ${criterion.maxScore}. Raise the maximum, or correct the ratings above it first.`,
        };
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    if (doomed.length > 0) {
      await tx.learnerCriterion.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });
    }
    for (const [index, c] of cleaned.entries()) {
      const data = { label: c.label, maxScore: c.maxScore, derived: c.derived, displayOrder: index };
      if (c.id && existing.some((e) => e.id === c.id)) {
        await tx.learnerCriterion.update({ where: { id: c.id }, data });
      } else {
        await tx.learnerCriterion.create({ data: { ...data, programmeId } });
      }
    }
  });

  await logAudit({
    actorId: user.userId,
    action: 'LEARNER_CRITERIA_SAVED',
    entityType: 'Programme',
    entityId: programmeId,
    after: { learnerCriteria: cleaned.map((c) => ({ label: c.label, maxScore: c.maxScore, derived: c.derived })) },
  });
  revalidatePath(`/programmes/${programmeId}/learners`);
  return { ok: true };
}

/** Seed the college's five, for a programme that has none yet. */
export async function seedLearnerCriteriaAction(programmeId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'learners.configure', programmeId });

  const existing = await prisma.learnerCriterion.count({ where: { programmeId } });
  if (existing > 0) return { ok: false, error: 'This programme already has criteria.' };

  await prisma.learnerCriterion.createMany({
    data: DEFAULT_LEARNER_CRITERIA.map((c, index) => ({ ...c, programmeId, displayOrder: index })),
  });
  revalidatePath(`/programmes/${programmeId}/learners`);
  return { ok: true };
}

/**
 * Set (or clear) the programme's category bands.
 *
 * Passing null clears the override and falls back to the institution's
 * table, then to the engine's default — the §4 chain, and the report says
 * which one it landed on.
 */
export async function saveLearnerBandsAction(
  programmeId: string,
  bands: { lowerPercent: number; category: string }[] | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'learners.configure', programmeId });

  if (bands !== null) {
    const parsed = parseBands(bands);
    if (!parsed) {
      return {
        ok: false,
        error:
          'Each band needs a name and a distinct starting score between 0 and 100, and one of them must start at 0 so that every score lands somewhere.',
      };
    }
  }

  // Prisma.DbNull, not undefined: on a nullable Json column `undefined`
  // means "leave it alone", which would make clearing the override a
  // silent no-op.
  await prisma.programme.update({
    where: { id: programmeId },
    data: { learnerBands: bands === null ? Prisma.DbNull : bands },
  });
  await logAudit({
    actorId: user.userId,
    action: 'LEARNER_BANDS_SAVED',
    entityType: 'Programme',
    entityId: programmeId,
    after: { learnerBands: bands },
  });
  revalidatePath(`/programmes/${programmeId}/learners`);
  return { ok: true };
}
