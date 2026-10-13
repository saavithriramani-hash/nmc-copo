import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CourseImport } from '@/components/CourseImport';
import { importableBatches } from '@/lib/courseImportData';
import { requireSession } from '@/lib/session';

/**
 * CR-11: create many courses from one file — the examinations office's
 * catalogue for a semester in a single upload. Reachable by whoever may
 * create a course in at least one department (the Guard decides, per
 * department); everyone else is sent back, as from "New course".
 */
export default async function CourseImportPage() {
  const user = await requireSession();
  const batches = await importableBatches(user.userId);
  if (batches.length === 0) {
    // Holding the permission but with no batch to put a course in yet.
    if (!user.roles.some((role) => role.kind === 'COE')) redirect('/');
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Import courses</h1>
        <p className="text-xs text-gray-600">
          <Link href="/courses" className="text-blue-700 hover:underline">
            ← Courses
          </Link>
        </p>
      </div>
      {batches.length === 0 ? (
        <p className="text-gray-600">
          There are no batches yet. Create one on a programme page first — a course belongs to the cohort that takes it.
        </p>
      ) : (
        <CourseImport />
      )}
    </div>
  );
}
