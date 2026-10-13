import 'server-only';
import { guard } from './authz';
import { batchLabel, type KnownBatch } from './courseImport';
import { prisma } from './db';

/**
 * The batches this user may create courses in, labelled as the import
 * file names them (CR-11). The Guard decides per department —
 * `course.create` is department-scoped — so the template's dropdown and
 * the importer's matching offer exactly what creating by hand would.
 * A college has tens of departments, so this is tens of checks, not one
 * per batch.
 */
export async function importableBatches(userId: string): Promise<KnownBatch[]> {
  const batches = await prisma.batch.findMany({
    select: {
      id: true,
      name: true,
      programme: { select: { name: true, departmentId: true, department: { select: { name: true } } } },
    },
    orderBy: [{ programme: { department: { name: 'asc' } } }, { programme: { name: 'asc' } }, { startYear: 'desc' }],
  });

  const allowed = new Map<string, boolean>();
  for (const departmentId of new Set(batches.map((b) => b.programme.departmentId))) {
    allowed.set(departmentId, (await guard.check(userId, { type: 'course.create', departmentId })).allow);
  }

  return batches
    .filter((b) => allowed.get(b.programme.departmentId))
    .map((b) => ({
      id: b.id,
      departmentId: b.programme.departmentId,
      label: batchLabel({
        departmentName: b.programme.department.name,
        programmeName: b.programme.name,
        batchName: b.name,
      }),
    }));
}
