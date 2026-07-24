'use server';

import { revalidatePath } from 'next/cache';
import { bulkUpsertMarks, marksForAssessment, type MarkUpsert } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { decodeSpreadsheet } from '@/lib/spreadsheet';
import { parseDelimited } from '@/lib/delimited';
import { planMarkImport, type MarkImportPlan } from '@/lib/marks';

export interface MarkCellInput {
  enrolmentId: string;
  itemId: string;
  /** null = did not attempt. */
  value: number | null;
}

/**
 * Loads the validated context for one assessment: which enrolments and
 * items are legitimate, and each item's maximum. Used to validate every
 * write so a save can never reference another course's rows.
 */
async function loadAssessmentContext(assessmentId: string) {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      id: true,
      courseId: true,
      items: { select: { id: true, maxMark: true } },
    },
  });
  const enrolments = await prisma.enrolment.findMany({
    where: { courseId: assessment.courseId },
    select: { id: true },
  });
  return {
    courseId: assessment.courseId,
    itemMax: new Map(assessment.items.map((item) => [item.id, item.maxMark.toNumber()])),
    enrolmentIds: new Set(enrolments.map((e) => e.id)),
  };
}

/**
 * FR-11 autosave: persist a batch of edited cells. Called incrementally
 * by the grid as faculty type; every cell is validated (enrolment ∈
 * course, item ∈ assessment, value ∈ [0, max] or blank) before the single
 * bulk upsert. Returns a server timestamp the grid shows as "saved".
 */
export async function saveMarksAction(
  assessmentId: string,
  cells: MarkCellInput[],
): Promise<{ ok: boolean; savedAt?: string; error?: string; rejected?: string[] }> {
  const user = await requireSession();
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } });
  if (!assessment) return { ok: false, error: 'Assessment not found.' };
  await guard.require(user.userId, { type: 'marks.write', courseId: assessment.courseId });

  if (cells.length === 0) return { ok: true, savedAt: new Date().toISOString() };

  const ctx = await loadAssessmentContext(assessmentId);
  const rejected: string[] = [];
  const valid: MarkUpsert[] = [];
  for (const cell of cells) {
    const max = ctx.itemMax.get(cell.itemId);
    const key = `${cell.enrolmentId}:${cell.itemId}`;
    if (max === undefined || !ctx.enrolmentIds.has(cell.enrolmentId)) {
      rejected.push(key);
      continue;
    }
    if (cell.value !== null && (!Number.isFinite(cell.value) || cell.value < 0 || cell.value > max)) {
      rejected.push(key);
      continue;
    }
    valid.push({ enrolmentId: cell.enrolmentId, itemId: cell.itemId, assessmentId, courseId: ctx.courseId, value: cell.value });
  }

  if (valid.length > 0) await bulkUpsertMarks(prisma, valid);
  // Deliberately NOT audit-logged per cell — mark entry is high volume;
  // the immutable snapshot at lock time is the audit record of the marks.
  return {
    ok: rejected.length === 0,
    savedAt: new Date().toISOString(),
    ...(rejected.length > 0 ? { error: `${rejected.length} cell(s) rejected by validation`, rejected } : {}),
  };
}

// ── FR-12: paste / upload one assessment's marks ────────────────────────

export interface MarkImportPreview {
  ok: boolean;
  error?: string;
  plan?: MarkImportPlan;
}

async function buildImportPlan(assessmentId: string, grid: string[][]): Promise<MarkImportPlan> {
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      courseId: true,
      items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } },
    },
  });
  const enrolments = await prisma.enrolment.findMany({
    where: { courseId: assessment.courseId },
    select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
  });
  const existingRows = await marksForAssessment(prisma, assessmentId);
  const existing = new Map(existingRows.map((row) => [`${row.enrolmentId}:${row.itemId}`, row.value]));

  return planMarkImport({
    rows: grid,
    items: assessment.items.map((item) => ({ id: item.id, label: item.label, maxMark: item.maxMark.toNumber() })),
    enrolments: enrolments.map((e) => ({
      enrolmentId: e.id,
      registerNumber: e.rosterEntry.registerNumber,
      studentName: e.rosterEntry.student.fullName,
    })),
    existing,
  });
}

/** Preview a pasted (TSV) or uploaded (CSV/Excel) mark sheet. Writes nothing. */
export async function previewMarkImportAction(
  assessmentId: string,
  input: { pasted?: string; formData?: FormData },
): Promise<MarkImportPreview> {
  const user = await requireSession();
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId }, select: { courseId: true } });
  if (!assessment) return { ok: false, error: 'Assessment not found.' };
  await guard.require(user.userId, { type: 'marks.write', courseId: assessment.courseId });

  let grid: string[][];
  if (input.pasted !== undefined) {
    grid = parseDelimited(input.pasted);
  } else {
    const file = input.formData?.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Paste marks or choose a file.' };
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'File is larger than 5 MB.' };
    try {
      grid = await decodeSpreadsheet(file);
    } catch {
      return { ok: false, error: 'Could not read the file. Save it as .xlsx or .csv and try again.' };
    }
  }
  if (grid.length < 2) return { ok: false, error: 'Need a header row (register number + item labels) and at least one student row.' };

  return { ok: true, plan: await buildImportPlan(assessmentId, grid) };
}

/** Applies the confirmed changes from a previewed import via the same validated save path. */
export async function commitMarkImportAction(
  assessmentId: string,
  changes: MarkCellInput[],
): Promise<{ ok: boolean; applied?: number; error?: string; rejected?: string[] }> {
  const result = await saveMarksAction(assessmentId, changes);
  if (result.ok || (result.rejected && result.rejected.length < changes.length)) {
    await logAudit({
      actorId: (await requireSession()).userId,
      action: 'MARKS_IMPORTED',
      entityType: 'Assessment',
      entityId: assessmentId,
      after: { applied: changes.length - (result.rejected?.length ?? 0) },
    });
    revalidatePath(`/courses`);
  }
  return {
    ok: result.ok,
    applied: changes.length - (result.rejected?.length ?? 0),
    ...(result.error ? { error: result.error } : {}),
    ...(result.rejected ? { rejected: result.rejected } : {}),
  };
}
