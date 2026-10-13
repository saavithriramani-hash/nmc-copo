import type { ReactNode } from 'react';
import { groupCourses, startsOpen, type GroupableCourse } from '@/lib/courseGroups';

/**
 * Courses as foldable sections: programme, then batch, then whatever
 * table the caller renders for that batch's courses. Server component —
 * folding is the browser's own <details>, so it needs no script, works
 * from the keyboard, and survives a page that has not hydrated.
 *
 * Programmes start open when the list is short and folded when it is
 * long (lib/courseGroups.ts); batches always start open, so unfolding a
 * programme shows its courses at once.
 */
export function CourseGroups<T extends GroupableCourse>({
  courses,
  showDepartment = false,
  renderTable,
}: {
  courses: readonly T[];
  /** Name the department in each programme heading — for college-wide lists. */
  showDepartment?: boolean;
  renderTable: (courses: T[]) => ReactNode;
}) {
  const open = startsOpen(courses.length);

  return (
    <div className="space-y-2">
      {groupCourses(courses).map((programme) => (
        <details key={programme.programmeId} open={open} className="border border-gray-300 rounded bg-white">
          <summary className="cursor-pointer select-none px-3 py-2 bg-gray-100 rounded hover:bg-gray-200">
            <span className="font-medium">{programme.programmeName}</span>
            {showDepartment ? <span className="text-gray-600"> · {programme.departmentName}</span> : null}
            <span className="text-xs text-gray-500">
              {' '}
              · {programme.courseCount} course{programme.courseCount === 1 ? '' : 's'}
            </span>
          </summary>
          <div className="p-2 space-y-2">
            {programme.batches.map((batch) => (
              <details key={batch.batchId} open className="border border-gray-200 rounded">
                <summary className="cursor-pointer select-none px-2 py-1 text-sm hover:bg-blue-50">
                  <span className="font-medium">{batch.batchName}</span>
                  <span className="text-xs text-gray-500">
                    {' '}
                    · {batch.courses.length} course{batch.courses.length === 1 ? '' : 's'}
                  </span>
                </summary>
                <div className="p-1">{renderTable(batch.courses)}</div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
