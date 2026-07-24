'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { DEFAULT_PARAMETERS } from '@copo/engine';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';

/** Institution + departments + programmes + batches: FR-1 structure, ADMIN-scoped. */

export async function createInstitutionAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });
  if ((await prisma.institution.count()) > 0) redirect('/admin/departments?error=Institution+already+exists');

  const name = String(formData.get('name') ?? '').trim();
  if (!name) redirect('/admin/departments?error=Name+is+required');

  const P = DEFAULT_PARAMETERS;
  const created = await prisma.institution.create({
    data: {
      name,
      thresholdFraction: new Prisma.Decimal(P.thresholdFraction),
      bands: P.bands as unknown as Prisma.InputJsonValue,
      cohortBands: P.cohortBands as unknown as Prisma.InputJsonValue,
      weightGroups: P.weightGroups as unknown as Prisma.InputJsonValue,
      directWeight: new Prisma.Decimal(P.directWeight),
      indirectWeight: new Prisma.Decimal(P.indirectWeight),
      targetAttainment: new Prisma.Decimal(P.targetAttainment),
      feedbackResponseFloor: P.feedbackResponseFloor,
    },
  });
  await logAudit({ actorId: user.userId, action: 'INSTITUTION_CREATED', entityType: 'Institution', entityId: created.id, after: { name } });
  revalidatePath('/admin/departments');
}

export async function createDepartmentAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const name = String(formData.get('name') ?? '').trim();
  if (!name) redirect('/admin/departments?error=Name+is+required');

  const institution = await prisma.institution.findFirst();
  if (!institution) redirect('/admin/departments?error=Create+the+institution+first');

  const created = await prisma.department.create({ data: { institutionId: institution.id, name } });
  await logAudit({ actorId: user.userId, action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: created.id, after: { name } });
  revalidatePath('/admin/departments');
}

export async function createProgrammeAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const departmentId = String(formData.get('departmentId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!departmentId || !name) redirect('/admin/departments?error=Department+and+name+are+required');

  const created = await prisma.programme.create({ data: { departmentId, name } });
  await logAudit({ actorId: user.userId, action: 'PROGRAMME_CREATED', entityType: 'Programme', entityId: created.id, after: { departmentId, name } });
  revalidatePath('/programmes');
  revalidatePath('/admin/departments');
}

export async function createBatchAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const programmeId = String(formData.get('programmeId') ?? '');
  const startYear = Number(formData.get('startYear'));
  const endYear = Number(formData.get('endYear'));
  if (!programmeId || !Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear <= startYear) {
    redirect(`/programmes/${programmeId}?error=Valid+start+and+end+years+are+required`);
  }

  const name = `${startYear}–${endYear}`;
  const created = await prisma.batch.create({ data: { programmeId, name, startYear, endYear } });
  await logAudit({ actorId: user.userId, action: 'BATCH_CREATED', entityType: 'Batch', entityId: created.id, after: { programmeId, name } });
  revalidatePath(`/programmes/${programmeId}`);
}

/** PO/PSO definitions (FR-2) — programme coordinator. Replace-all save. */
export interface OutcomeRow {
  id: string | null;
  code: string;
  kind: 'PO' | 'PSO';
  statement: string;
}

export async function saveOutcomesAction(
  programmeId: string,
  rows: OutcomeRow[],
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'programme.manage', programmeId });

  for (const row of rows) {
    if (!row.code.trim() || !row.statement.trim()) return { error: 'Every PO/PSO needs a code and a statement.' };
  }
  const codes = rows.map((r) => r.code.trim());
  if (new Set(codes).size !== codes.length) return { error: 'PO/PSO codes must be unique.' };

  const existing = await prisma.programmeOutcome.findMany({ where: { programmeId } });
  const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id as string));
  const removed = existing.filter((outcome) => !keptIds.has(outcome.id));

  try {
    await prisma.$transaction(async (tx) => {
      for (const outcome of removed) {
        // Removing a PO that a course matrix references must fail loudly,
        // not silently unmap courses. The FK RESTRICT does exactly that.
        await tx.programmeOutcome.delete({ where: { id: outcome.id } });
      }
      for (const [index, row] of rows.entries()) {
        if (row.id) {
          await tx.programmeOutcome.update({
            where: { id: row.id },
            data: { code: row.code.trim(), kind: row.kind, statement: row.statement.trim(), displayOrder: index + 1 },
          });
        } else {
          await tx.programmeOutcome.create({
            data: {
              programmeId,
              code: row.code.trim(),
              kind: row.kind,
              statement: row.statement.trim(),
              displayOrder: index + 1,
            },
          });
        }
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return { error: 'A removed PO/PSO is still mapped in a course articulation matrix. Unmap it there first.' };
    }
    throw err;
  }

  await logAudit({
    actorId: user.userId,
    action: 'OUTCOMES_SAVED',
    entityType: 'Programme',
    entityId: programmeId,
    before: existing.map((o) => ({ code: o.code, kind: o.kind, statement: o.statement })),
    after: rows.map((r) => ({ code: r.code, kind: r.kind, statement: r.statement })),
  });
  revalidatePath(`/programmes/${programmeId}`);
  return { ok: true };
}
