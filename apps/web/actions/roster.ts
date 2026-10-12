'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { decodeSpreadsheet } from '@/lib/spreadsheet';
import { parseRosterRows, planRosterImport, type RosterEntry } from '@/lib/roster';
import {
  shouldDeleteStudentRecord,
  studentBlockMessage,
  studentBlockingCourses,
  studentLabel,
} from '@/lib/catalogueRemoval';

async function departmentOfBatch(batchId: string): Promise<string> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    select: { programme: { select: { departmentId: true } } },
  });
  return batch.programme.departmentId;
}

export interface RosterPreview {
  ok: boolean;
  error?: string;
  fileName?: string;
  headerDetected?: boolean;
  columns?: { registerNumber: number; fullName: number; email: number | null };
  toCreate?: RosterEntry[];
  alreadyPresent?: RosterEntry[];
  parseErrors?: { row: number; message: string }[];
}

/**
 * FR-10 step 1: parse an uploaded roster and return a full preview of
 * what WOULD be created — nothing is written. The client shows this, then
 * calls commitRosterImportAction with the confirmed rows.
 */
export async function previewRosterImportAction(batchId: string, formData: FormData): Promise<RosterPreview> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'roster.manage', departmentId: await departmentOfBatch(batchId) });

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV or Excel file.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'File is larger than 5 MB.' };

  let grid: string[][];
  try {
    grid = await decodeSpreadsheet(file);
  } catch {
    return { ok: false, error: 'Could not read the file. Save it as .xlsx or .csv and try again.' };
  }

  const parsed = parseRosterRows(grid);
  const existing = await prisma.batchRoster.findMany({ where: { batchId }, select: { registerNumber: true } });
  const plan = planRosterImport(parsed.entries, existing.map((row) => row.registerNumber));

  return {
    ok: true,
    fileName: file.name,
    headerDetected: parsed.headerDetected,
    columns: parsed.columns,
    toCreate: plan.toCreate,
    alreadyPresent: plan.alreadyPresent,
    parseErrors: parsed.errors,
  };
}

/**
 * FR-10 step 2: write the confirmed new roster entries. Re-validates the
 * batch scope and skips any register number that now exists (idempotent
 * against a double submit). Creates a Student and a BatchRoster row per
 * new register number — the number lives only on the roster.
 */
export async function commitRosterImportAction(
  batchId: string,
  entries: RosterEntry[],
): Promise<{ ok: boolean; created?: number; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'roster.manage', departmentId: await departmentOfBatch(batchId) });
  if (entries.length === 0) return { ok: false, error: 'Nothing to import.' };

  const existing = new Set(
    (await prisma.batchRoster.findMany({ where: { batchId }, select: { registerNumber: true } })).map(
      (row) => row.registerNumber,
    ),
  );
  const fresh = entries.filter((entry) => entry.registerNumber && !existing.has(entry.registerNumber));

  await prisma.$transaction(async (tx) => {
    for (const entry of fresh) {
      const student = await tx.student.create({
        data: { fullName: entry.fullName, email: entry.email },
      });
      await tx.batchRoster.create({
        data: { batchId, studentId: student.id, registerNumber: entry.registerNumber },
      });
    }
  });

  await logAudit({
    actorId: user.userId,
    action: 'ROSTER_IMPORTED',
    entityType: 'Batch',
    entityId: batchId,
    after: { created: fresh.length, registerNumbers: fresh.map((entry) => entry.registerNumber) },
  });
  revalidatePath(`/batches/${batchId}/roster`);
  return { ok: true, created: fresh.length };
}

/**
 * CR-9: remove one student from a batch roster — `roster.manage`, the
 * COE. Refused while the student holds marks or learner ratings on any
 * course, naming those courses (catalogueRemoval.ts). Otherwise their
 * enrolments go with the roster entry, and the Student record too when
 * this batch was its only one.
 *
 * Race safety: a mark or rating written after the check makes the
 * enrolment delete fail on its RESTRICT foreign key and rolls back.
 */
export async function removeRosterEntryAction(
  batchId: string,
  rosterEntryId: string,
): Promise<{ ok?: true; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'roster.manage', departmentId: await departmentOfBatch(batchId) });

  // Scoped to the batch the guard was asked about, so a roster entry of
  // another batch cannot be removed through this one's page.
  const entry = await prisma.batchRoster.findFirst({
    where: { id: rosterEntryId, batchId },
    select: {
      registerNumber: true,
      studentId: true,
      student: { select: { fullName: true, email: true } },
      enrolments: {
        select: {
          courseId: true,
          course: { select: { code: true } },
          _count: { select: { markValues: true, learnerRatings: true } },
        },
      },
    },
  });
  if (!entry) return { error: 'That student is no longer on this roster.' };

  const label = { registerNumber: entry.registerNumber, fullName: entry.student.fullName };
  const blocking = studentBlockingCourses(
    entry.enrolments.map((e) => ({
      courseCode: e.course.code,
      marks: e._count.markValues,
      learnerRatings: e._count.learnerRatings,
    })),
  );
  if (blocking.length > 0) return { error: studentBlockMessage(label, blocking) };

  let studentDeleted = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.enrolment.deleteMany({ where: { rosterEntryId } });
      await tx.batchRoster.delete({ where: { id: rosterEntryId } });
      const others = await tx.batchRoster.count({ where: { studentId: entry.studentId } });
      if (shouldDeleteStudentRecord(others)) {
        await tx.student.delete({ where: { id: entry.studentId } });
        studentDeleted = true;
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2025')) {
      return { error: `“${studentLabel(label)}” changed while you were removing them. Reload the page and look again.` };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'ROSTER_ENTRY_REMOVED',
    entityType: 'Batch',
    entityId: batchId,
    before: {
      rosterEntryId,
      registerNumber: entry.registerNumber,
      studentId: entry.studentId,
      fullName: entry.student.fullName,
      email: entry.student.email,
      enrolledCourseIds: entry.enrolments.map((e) => e.courseId),
    },
    after: { studentRecordDeleted: studentDeleted },
  });
  revalidatePath(`/batches/${batchId}/roster`);
  return { ok: true };
}
