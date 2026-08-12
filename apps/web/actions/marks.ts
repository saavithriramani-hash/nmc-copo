'use server';

import { revalidatePath } from 'next/cache';
import { bulkUpsertMarks, marksForAssessment, type MarkUpsert } from '@copo/db';
import { prisma } from '@/lib/db';
import { canWriteMarks, guard, requireMarksWrite } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { decodeSpreadsheet, decodeWorkbookSheets } from '@/lib/spreadsheet';
import { parseDelimited } from '@/lib/delimited';
import { planCourseImport, type CourseImportPlan } from '@/lib/courseWorkbook';
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
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { courseId: true, weightGroup: true },
  });
  if (!assessment) return { ok: false, error: 'Assessment not found.' };
  // CR-3: the end-semester paper is the COE's on a theory course and the
  // department's on a practical one; every other assessment is the
  // course chain's.
  await requireMarksWrite(user.userId, assessment.courseId, assessment.weightGroup);

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
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { courseId: true, weightGroup: true },
  });
  if (!assessment) return { ok: false, error: 'Assessment not found.' };
  await requireMarksWrite(user.userId, assessment.courseId, assessment.weightGroup);

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

// ── FR-12: the whole course in one workbook ─────────────────────────────

export interface CourseMarkImportPreview {
  ok: boolean;
  error?: string;
  fileName?: string;
  plan?: CourseImportPlan;
}

/**
 * Everything the course-wide planner needs, loaded once.
 *
 * Assessments with no questions are excluded: they have no columns to
 * receive marks, they get no sheet in the downloaded workbook, and
 * including them here would report them as sheets somebody forgot.
 */
async function loadCourseImportContext(courseId: string, userId: string) {
  const assessments = await prisma.assessment.findMany({
    where: { courseId },
    orderBy: { displayOrder: 'asc' },
    select: {
      id: true,
      name: true,
      weightGroup: true,
      items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } },
    },
  });
  const enrolments = await prisma.enrolment.findMany({
    where: { courseId },
    select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
  });

  // CR-3: the workbook must not become a way around the split. Only the
  // assessments this person may actually write are planned against; the
  // rest are named back so the preview can say why they were left out,
  // rather than reporting them as sheets matching nothing.
  const writable: typeof assessments = [];
  const notPermitted: string[] = [];
  for (const assessment of assessments) {
    if (assessment.items.length === 0) continue;
    if (await canWriteMarks(userId, courseId, assessment.weightGroup)) writable.push(assessment);
    else notPermitted.push(assessment.name);
  }

  const withItems = writable;
  const existing = new Map<string, number | null>();
  for (const assessment of withItems) {
    for (const mark of await marksForAssessment(prisma, assessment.id)) {
      existing.set(`${mark.enrolmentId}:${mark.itemId}`, mark.value);
    }
  }

  return {
    assessments: withItems.map((assessment) => ({
      id: assessment.id,
      name: assessment.name,
      items: assessment.items.map((item) => ({ id: item.id, label: item.label, maxMark: item.maxMark.toNumber() })),
    })),
    enrolments: enrolments.map((e) => ({
      enrolmentId: e.id,
      registerNumber: e.rosterEntry.registerNumber,
      studentName: e.rosterEntry.student.fullName,
    })),
    existing,
    notPermitted,
  };
}

/** Preview an uploaded course workbook. Writes nothing. */
export async function previewCourseMarkImportAction(
  courseId: string,
  formData: FormData,
): Promise<CourseMarkImportPreview> {
  const user = await requireSession();
  // Reading is the bar for previewing; which sheets may actually be
  // applied is decided per assessment below (CR-3).
  await guard.require(user.userId, { type: 'marks.read', courseId });

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose the course mark workbook.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'File is larger than 10 MB.' };

  let sheets: Map<string, string[][]>;
  try {
    sheets = await decodeWorkbookSheets(file);
  } catch {
    return { ok: false, error: 'Could not read the file. Upload the .xlsx workbook downloaded from this page.' };
  }
  if (sheets.size === 0) {
    return {
      ok: false,
      error:
        'This is not an Excel workbook. The course workbook carries one sheet per assessment, which a CSV cannot — download it from this page, fill it in, and upload that.',
    };
  }

  const { notPermitted, ...context } = await loadCourseImportContext(courseId, user.userId);
  if (context.assessments.length === 0) {
    return {
      ok: false,
      error:
        notPermitted.length > 0
          ? `Nothing in this course is yours to enter. ${notPermitted.join(', ')} ${notPermitted.length === 1 ? 'is' : 'are'} entered elsewhere.`
          : 'No assessment in this course has any questions yet.',
    };
  }

  return {
    ok: true,
    fileName: file.name,
    plan: { ...planCourseImport({ sheets, ...context }), notPermitted },
  };
}

/**
 * Applies a previewed course workbook — **all of it or none of it**.
 *
 * Every assessment is written inside one transaction, so an upload can
 * never leave a course half-imported: with several assessments feeding
 * one attainment figure, "three of eight applied" is a state nobody could
 * reason about before a lock. Validation is the same as the single-sheet
 * path — enrolment ∈ course, item ∈ assessment, value ∈ [0, max] or blank
 * — and here a single rejected cell aborts the lot rather than being
 * reported afterwards, because the caller has already been shown and has
 * confirmed exactly these changes.
 */
export async function commitCourseMarkImportAction(
  courseId: string,
  changes: { assessmentId: string; cells: MarkCellInput[] }[],
): Promise<{ ok: boolean; applied?: number; assessments?: number; error?: string }> {
  const user = await requireSession();

  const wanted = changes.filter((entry) => entry.cells.length > 0);
  if (wanted.length === 0) return { ok: false, error: 'Nothing to import.' };

  // Re-derive what is legitimate from the database rather than trusting
  // the payload: the preview it came from is a client-side object.
  const assessments = await prisma.assessment.findMany({
    where: { courseId, id: { in: wanted.map((entry) => entry.assessmentId) } },
    select: { id: true, name: true, weightGroup: true, items: { select: { id: true, maxMark: true } } },
  });
  const byId = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  const enrolmentIds = new Set(
    (await prisma.enrolment.findMany({ where: { courseId }, select: { id: true } })).map((e) => e.id),
  );

  const perAssessment: { assessmentId: string; name: string; cells: MarkUpsert[] }[] = [];
  for (const entry of wanted) {
    const assessment = byId.get(entry.assessmentId);
    if (!assessment) return { ok: false, error: 'That workbook refers to an assessment this course does not have. Download it again.' };
    // Per assessment, from its own weight group — the payload arrived
    // from the client and cannot be trusted about which sheets it holds.
    await requireMarksWrite(user.userId, courseId, assessment.weightGroup);
    const itemMax = new Map(assessment.items.map((item) => [item.id, item.maxMark.toNumber()]));

    const cells: MarkUpsert[] = [];
    for (const cell of entry.cells) {
      const max = itemMax.get(cell.itemId);
      if (max === undefined || !enrolmentIds.has(cell.enrolmentId)) {
        return { ok: false, error: `A mark in “${assessment.name}” does not belong to this course. Nothing was imported.` };
      }
      if (cell.value !== null && (!Number.isFinite(cell.value) || cell.value < 0 || cell.value > max)) {
        return { ok: false, error: `A mark in “${assessment.name}” is outside its question's range. Nothing was imported.` };
      }
      cells.push({ enrolmentId: cell.enrolmentId, itemId: cell.itemId, assessmentId: assessment.id, courseId, value: cell.value });
    }
    perAssessment.push({ assessmentId: assessment.id, name: assessment.name, cells });
  }

  const applied = perAssessment.reduce((sum, entry) => sum + entry.cells.length, 0);
  await prisma.$transaction(async (tx) => {
    for (const entry of perAssessment) await bulkUpsertMarks(tx, entry.cells);
  });

  // One entry per assessment, so the log keeps the entity linkage the
  // single-sheet import already writes; the shared marker ties them
  // together as one upload.
  for (const entry of perAssessment) {
    await logAudit({
      actorId: user.userId,
      action: 'MARKS_IMPORTED',
      entityType: 'Assessment',
      entityId: entry.assessmentId,
      after: { applied: entry.cells.length, viaCourseWorkbook: true },
    });
  }
  revalidatePath(`/courses/${courseId}/marks`);
  return { ok: true, applied, assessments: perAssessment.length };
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
