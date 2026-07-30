import { LoadingNote, SkeletonTable } from '@/components/Skeleton';

/**
 * Attainment is the slowest page in the application, and the only one
 * whose wait is worth explaining: nothing here is stored. Every figure is
 * recomputed from the course's marks on each view (§9 "no stored derived
 * values"), so the delay is the ten steps actually running — not a slow
 * query. The note says so.
 *
 * The skeleton carries the real column headers of both tables, so the
 * layout does not shift when the figures land.
 */
export default function AttainmentLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium">Attainment</h2>
        <LoadingNote>Computing from the current marks…</LoadingNote>
      </div>

      <section className="space-y-1">
        <h3 className="font-medium text-sm">Course outcome attainment (Step 9)</h3>
        <SkeletonTable columns={['CO', 'Direct', 'Indirect', 'Final', 'Target']} rows={5} />
      </section>

      <section className="space-y-2">
        <h3 className="font-medium text-sm">Programme outcome attainment (Step 10)</h3>
        <SkeletonTable columns={['PO/PSO', 'Weightage', 'Official', 'Secondary']} rows={6} />
      </section>
    </div>
  );
}
