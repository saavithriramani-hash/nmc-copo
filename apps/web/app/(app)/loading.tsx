import { LoadingNote, SkeletonHeading, SkeletonLine } from '@/components/Skeleton';

/**
 * Fallback for the top-level pages — courses, programmes, institution,
 * audit, admin. Sits below the application shell, so the header and the
 * navigation stay put and only the page body is replaced.
 *
 * Deeper segments (the course tabs) define their own, more specific,
 * skeletons; this one only ever shows for a route that has not.
 */
export default function AppLoading() {
  return (
    <div className="space-y-4">
      <SkeletonHeading width="w-56" />
      <div className="space-y-2">
        {['w-full', 'w-11/12', 'w-10/12', 'w-8/12'].map((width) => (
          <SkeletonLine key={width} className={width} />
        ))}
      </div>
      <LoadingNote>Loading…</LoadingNote>
    </div>
  );
}
