'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Prisma } from '@copo/db';
import { DEFAULT_PARAMETERS } from '@copo/engine';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import {
  batchBlockers,
  blockMessage,
  departmentBlockers,
  programmeBlockers,
  validateStructureName,
} from '@/lib/structureAdmin';

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

/* ── rename and delete (FR-1) ────────────────────────────────────────────
 *
 * ADMIN only, like creation. Deletion refuses while anything references
 * the row and says what; it is never a cascade, so no course, mark,
 * roster entry, role or locked snapshot is ever removed as a side effect.
 * `onDelete: Restrict` in the schema enforces the same rule at the
 * database, which is what makes the check-then-delete race fail safe.
 */

export type StructureResult = { error?: string; ok?: boolean };

/** A concurrent write slipped a dependant in between the check and the delete. */
function raceGuard(err: unknown, name: string): StructureResult {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    return { error: `“${name}” now has data depending on it. Reload the page and look again.` };
  }
  throw err;
}

function duplicateName(err: unknown, name: string): StructureResult {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return { error: `Another record here is already called “${name}”.` };
  }
  throw err;
}

export async function renameDepartmentAction(departmentId: string, rawName: string): Promise<StructureResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const problem = validateStructureName(rawName);
  if (problem) return { error: problem };
  const name = rawName.trim();

  const before = await prisma.department.findUnique({ where: { id: departmentId }, select: { name: true } });
  if (!before) return { error: 'That department no longer exists.' };
  if (before.name === name) return { ok: true };

  try {
    await prisma.department.update({ where: { id: departmentId }, data: { name } });
  } catch (err) {
    return duplicateName(err, name);
  }

  await logAudit({
    actorId: user.userId,
    action: 'DEPARTMENT_RENAMED',
    entityType: 'Department',
    entityId: departmentId,
    before: { name: before.name },
    after: { name },
  });
  revalidatePath('/admin/departments');
  return { ok: true };
}

export async function renameProgrammeAction(programmeId: string, rawName: string): Promise<StructureResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const problem = validateStructureName(rawName);
  if (problem) return { error: problem };
  const name = rawName.trim();

  const before = await prisma.programme.findUnique({ where: { id: programmeId }, select: { name: true } });
  if (!before) return { error: 'That programme no longer exists.' };
  if (before.name === name) return { ok: true };

  try {
    await prisma.programme.update({ where: { id: programmeId }, data: { name } });
  } catch (err) {
    return duplicateName(err, name);
  }

  await logAudit({
    actorId: user.userId,
    action: 'PROGRAMME_RENAMED',
    entityType: 'Programme',
    entityId: programmeId,
    before: { name: before.name },
    after: { name },
  });
  revalidatePath('/admin/departments');
  revalidatePath(`/programmes/${programmeId}`);
  return { ok: true };
}

export async function renameBatchAction(batchId: string, rawName: string): Promise<StructureResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const problem = validateStructureName(rawName);
  if (problem) return { error: problem };
  const name = rawName.trim();

  const before = await prisma.batch.findUnique({ where: { id: batchId }, select: { name: true, programmeId: true } });
  if (!before) return { error: 'That batch no longer exists.' };
  if (before.name === name) return { ok: true };

  try {
    await prisma.batch.update({ where: { id: batchId }, data: { name } });
  } catch (err) {
    return duplicateName(err, name);
  }

  await logAudit({
    actorId: user.userId,
    action: 'BATCH_RENAMED',
    entityType: 'Batch',
    entityId: batchId,
    before: { name: before.name },
    after: { name },
  });
  revalidatePath(`/programmes/${before.programmeId}`);
  return { ok: true };
}

export async function deleteDepartmentAction(departmentId: string): Promise<StructureResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { name: true, _count: { select: { programmes: true, roles: true, templates: true } } },
  });
  if (!department) return { error: 'That department no longer exists.' };

  const blockers = departmentBlockers({
    programmes: department._count.programmes,
    roles: department._count.roles,
    templates: department._count.templates,
  });
  if (blockers.length > 0) return { error: blockMessage(department.name, blockers) };

  try {
    await prisma.department.delete({ where: { id: departmentId } });
  } catch (err) {
    return raceGuard(err, department.name);
  }

  await logAudit({
    actorId: user.userId,
    action: 'DEPARTMENT_DELETED',
    entityType: 'Department',
    entityId: departmentId,
    before: { name: department.name },
  });
  revalidatePath('/admin/departments');
  return { ok: true };
}

export async function deleteProgrammeAction(programmeId: string): Promise<StructureResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: {
      name: true,
      outcomes: { select: { code: true, kind: true, statement: true } },
      _count: { select: { batches: true, roles: true } },
    },
  });
  if (!programme) return { error: 'That programme no longer exists.' };

  const blockers = programmeBlockers({ batches: programme._count.batches, roles: programme._count.roles });
  if (blockers.length > 0) return { error: blockMessage(programme.name, blockers) };

  // The programme's own PO/PSO definitions go with it: they are owned by
  // it, and with no batches there are no courses, so no articulation
  // matrix can cite them. Recorded in full in the audit entry below.
  try {
    await prisma.$transaction([
      prisma.programmeOutcome.deleteMany({ where: { programmeId } }),
      prisma.programme.delete({ where: { id: programmeId } }),
    ]);
  } catch (err) {
    return raceGuard(err, programme.name);
  }

  await logAudit({
    actorId: user.userId,
    action: 'PROGRAMME_DELETED',
    entityType: 'Programme',
    entityId: programmeId,
    before: { name: programme.name, outcomes: programme.outcomes },
  });
  revalidatePath('/admin/departments');
  return { ok: true };
}

export async function deleteBatchAction(batchId: string): Promise<StructureResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'departments.manage' });

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { name: true, programmeId: true, _count: { select: { courses: true, roster: true } } },
  });
  if (!batch) return { error: 'That batch no longer exists.' };

  const blockers = batchBlockers({ courses: batch._count.courses, roster: batch._count.roster });
  if (blockers.length > 0) return { error: blockMessage(batch.name, blockers) };

  try {
    await prisma.batch.delete({ where: { id: batchId } });
  } catch (err) {
    return raceGuard(err, batch.name);
  }

  await logAudit({
    actorId: user.userId,
    action: 'BATCH_DELETED',
    entityType: 'Batch',
    entityId: batchId,
    before: { name: batch.name },
  });
  revalidatePath(`/programmes/${batch.programmeId}`);
  return { ok: true };
}
