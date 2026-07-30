import { LoadingNote, SkeletonHeading, SkeletonLine } from '@/components/Skeleton';

/**
 * Fallback for every course tab that does not define its own
 * `loading.tsx`. It sits below the course layout, so the heading and the
 * tab bar stay on screen and only the content area is replaced — the tab
 * you clicked stays visible and marked busy while its data loads.
 *
 * Attainment overrides this with a table-shaped skeleton of its own.
 */
export default function CourseSectionLoading() {
  return (
    <div className="space-y-4">
      <SkeletonHeading />
      <div className="space-y-2">
        {['w-full', 'w-11/12', 'w-9/12', 'w-10/12', 'w-7/12'].map((width) => (
          <SkeletonLine key={width} className={width} />
        ))}
      </div>
      <LoadingNote>Loading…</LoadingNote>
    </div>
  );
}
