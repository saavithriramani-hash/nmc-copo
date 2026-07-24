'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { decodeSpreadsheet } from '@/lib/spreadsheet';
import { parseRosterRows, planRosterImport, type RosterEntry } from '@/lib/roster';

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
