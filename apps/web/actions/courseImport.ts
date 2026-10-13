'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@copo/db';
import { guard } from '@/lib/authz';
import {
  MAX_COURSE_IMPORT_ROWS,
  canCommit,
  parseCourseRows,
  planCourseImport,
  type CourseImportError,
  type PlannedCourse,
} from '@/lib/courseImport';
import { importableBatches } from '@/lib/courseImportData';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { decodeSpreadsheet } from '@/lib/spreadsheet';

/**
 * CR-11: bulk course import. Step 1 previews; step 2 creates. The file is
 * sent with BOTH steps and read and planned again at the second, rather
 * than trusting anything the client posts back from the preview — the
 * preview is a display; the commit is the decision.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024;

type PreviewRow = Pick<PlannedCourse, 'sourceRow' | 'batchLabel' | 'code' | 'title' | 'semester' | 'credits' | 'isLaboratory'>;

export type CourseImportPreview =
  | { ok: false; error: string }
  | {
      ok: true;
      fileName: string;
      headerDetected: boolean;
      toCreate: PreviewRow[];
      alreadyExists: PreviewRow[];
      errors: CourseImportError[];
      canCommit: boolean;
    };

type Read =
  | { ok: false; error: string }
  | {
      ok: true;
      fileName: string;
      headerDetected: boolean;
      toCreate: PlannedCourse[];
      alreadyExists: PlannedCourse[];
      errors: CourseImportError[];
      canCommit: boolean;
    };

async function readAndPlan(userId: string, formData: FormData): Promise<Read> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV or Excel file.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'The file is larger than 5 MB.' };

  let grid: string[][];
  try {
    grid = await decodeSpreadsheet(file);
  } catch {
    return { ok: false, error: 'Could not read the file. Upload the Excel template, or a CSV.' };
  }

  const parsed = parseCourseRows(grid);
  const rowCount = parsed.rows.length + parsed.errors.length;
  if (rowCount > MAX_COURSE_IMPORT_ROWS) {
    return { ok: false, error: `This file has ${rowCount} rows; the limit is ${MAX_COURSE_IMPORT_ROWS} at a time.` };
  }
  if (rowCount === 0) return { ok: false, error: 'The file has no course rows.' };

  const batches = await importableBatches(userId);
  const named = new Set(batches.map((b) => b.id));
  const existing = await prisma.course.findMany({
    where: { batchId: { in: [...named] }, code: { in: [...new Set(parsed.rows.map((r) => r.code))] } },
    select: { batchId: true, code: true },
  });
  const plan = planCourseImport(parsed.rows, batches, existing);
  const errors = [...parsed.errors, ...plan.errors].sort((a, b) => a.row - b.row);

  return {
    ok: true,
    fileName: file.name,
    headerDetected: parsed.headerDetected,
    toCreate: plan.toCreate,
    alreadyExists: plan.alreadyExists,
    errors,
    canCommit: canCommit(parsed.errors, plan),
  };
}

const forDisplay = (rows: PlannedCourse[]): PreviewRow[] =>
  rows.map(({ sourceRow, batchLabel, code, title, semester, credits, isLaboratory }) => ({
    sourceRow,
    batchLabel,
    code,
    title,
    semester,
    credits,
    isLaboratory,
  }));

export async function previewCourseImportAction(formData: FormData): Promise<CourseImportPreview> {
  const user = await requireSession();
  const read = await readAndPlan(user.userId, formData);
  if (!read.ok) return read;
  return { ...read, toCreate: forDisplay(read.toCreate), alreadyExists: forDisplay(read.alreadyExists) };
}

export async function commitCourseImportAction(
  formData: FormData,
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  const user = await requireSession();
  const read = await readAndPlan(user.userId, formData);
  if (!read.ok) return read;
  if (!read.canCommit) {
    return {
      ok: false,
      error:
        read.errors.length > 0
          ? 'The file has problems. Nothing was created — fix the rows listed and upload it again.'
          : 'There is nothing new to create.',
    };
  }

  // The batches came from importableBatches, which already asked the
  // Guard; asking again here makes the authority explicit at the write.
  for (const departmentId of new Set(read.toCreate.map((c) => c.departmentId))) {
    await guard.require(user.userId, { type: 'course.create', departmentId });
  }

  // One INSERT for the whole file: atomic on its own, so the catalogue is
  // never half-imported, and fast enough for a full semester where a
  // thousand round trips inside an interactive transaction would risk its
  // timeout.
  let created: { id: string; course: PlannedCourse }[];
  try {
    const rows = await prisma.course.createManyAndReturn({
      data: read.toCreate.map((course) => ({
        batchId: course.batchId,
        code: course.code,
        title: course.title,
        semester: course.semester,
        credits: course.credits === null ? null : new Prisma.Decimal(course.credits),
        isLaboratory: course.isLaboratory,
      })),
      select: { id: true, batchId: true, code: true },
    });
    // Matched back by (batch, code), which is unique — not by position,
    // which the database does not promise to preserve.
    const byKey = new Map(read.toCreate.map((course) => [`${course.batchId}\u0000${course.code}`, course]));
    created = rows.map((row) => ({ id: row.id, course: byKey.get(`${row.batchId}\u0000${row.code}`)! }));
  } catch (err) {
    // Someone created one of these codes between the plan and the write.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'A course in this file was created by someone else just now. Nothing was created — preview the file again.' };
    }
    throw err;
  }

  // One audit entry per course, as "New course" writes — so each course's
  // history starts the same way however it was created — in one INSERT.
  await prisma.auditLog.createMany({
    data: created.map(({ id, course }) => ({
      actorId: user.userId,
      action: 'COURSE_CREATED',
      entityType: 'Course',
      entityId: id,
      after: {
        batchId: course.batchId,
        code: course.code,
        title: course.title,
        semester: course.semester,
        credits: course.credits,
        isLaboratory: course.isLaboratory,
        instructorId: null,
        source: 'bulk import',
        fileName: read.fileName,
        sourceRow: course.sourceRow,
      },
    })),
  });

  revalidatePath('/courses');
  return { ok: true, created: created.length, skipped: read.alreadyExists.length };
}
