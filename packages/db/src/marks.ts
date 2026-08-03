import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * The hot write path for mark entry (FR-11, NFR-3). One parameterised
 * bulk UPSERT keyed on the MarkValue primary key (enrolmentId, itemId),
 * so several hundred faculty saving at once each touch only their own
 * changed rows — never a table scan, never a whole course in memory.
 *
 * value = null persists "did not attempt" (distinct from 0). The
 * duplicated assessmentId/courseId are set from the caller's validated
 * values; the composite foreign keys still reject any mark whose
 * enrolment and item belong to different courses, so even this raw path
 * cannot create a cross-course mark.
 */
export interface MarkUpsert {
  enrolmentId: string;
  itemId: string;
  assessmentId: string;
  courseId: string;
  /** null = did not attempt. */
  value: number | null;
}

/**
 * Anything that can run the statement: the client itself, or a
 * transaction handle. The course-wide mark import applies several
 * assessments in one transaction — all of them or none — and cannot do
 * that if this insists on the top-level client.
 */
export type MarkWriter = Pick<PrismaClient, '$executeRaw'>;

/** Upserts marks in batches. Returns the number of rows written. */
export async function bulkUpsertMarks(prisma: MarkWriter, cells: MarkUpsert[], batchSize = 500): Promise<number> {
  let written = 0;
  for (let start = 0; start < cells.length; start += batchSize) {
    const batch = cells.slice(start, start + batchSize);
    const values = batch.map(
      (cell) =>
        Prisma.sql`(${cell.enrolmentId}, ${cell.itemId}, ${cell.assessmentId}, ${cell.courseId}, ${
          cell.value === null ? null : cell.value.toString()
        }::decimal, now())`,
    );
    written += await prisma.$executeRaw`
      INSERT INTO "MarkValue" ("enrolmentId", "itemId", "assessmentId", "courseId", "value", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("enrolmentId", "itemId")
      DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`;
  }
  return written;
}

/**
 * All marks for one assessment, as a flat list keyed by enrolment and
 * item, fetched through the (assessmentId, enrolmentId) index. Bounded by
 * the assessment's own size — never the 25M-row table (NFR-1). This is the
 * grid's load query and the import diff's "before" snapshot.
 */
export async function marksForAssessment(
  prisma: PrismaClient,
  assessmentId: string,
): Promise<{ enrolmentId: string; itemId: string; value: number | null }[]> {
  const rows = await prisma.markValue.findMany({
    where: { assessmentId },
    select: { enrolmentId: true, itemId: true, value: true },
  });
  return rows.map((row) => ({
    enrolmentId: row.enrolmentId,
    itemId: row.itemId,
    value: row.value === null ? null : row.value.toNumber(),
  }));
}
