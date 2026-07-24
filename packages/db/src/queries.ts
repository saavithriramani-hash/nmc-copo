import type { PrismaClient } from '@prisma/client';

/**
 * Summary queries — the NFR-1 pattern. Summaries are computed BY THE
 * DATABASE with aggregation over the MarkValue indexes; mark values never
 * enter application memory for a summary. Follow this pattern for every
 * future dashboard/anomaly/progress figure (FR-13).
 */

export interface ItemMarkSummary {
  itemId: string;
  /** Mark rows recorded for the item (attempted + explicit blanks). */
  recorded: number;
  /** Non-null marks — the engine's denominator for this item. */
  attempted: number;
  /** Explicit "did not attempt" entries (value IS NULL). */
  blank: number;
}

/**
 * Per-item completeness for one assessment, aggregated in SQL through the
 * (assessmentId, enrolmentId) index.
 */
export async function assessmentMarkSummary(prisma: PrismaClient, assessmentId: string): Promise<ItemMarkSummary[]> {
  const [recorded, attempted] = await Promise.all([
    prisma.markValue.groupBy({
      by: ['itemId'],
      where: { assessmentId },
      _count: { _all: true },
    }),
    prisma.markValue.groupBy({
      by: ['itemId'],
      where: { assessmentId, value: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const attemptedByItem = new Map(attempted.map((row) => [row.itemId, row._count._all]));
  return recorded
    .map((row) => {
      const attemptedCount = attemptedByItem.get(row.itemId) ?? 0;
      return {
        itemId: row.itemId,
        recorded: row._count._all,
        attempted: attemptedCount,
        blank: row._count._all - attemptedCount,
      };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}
