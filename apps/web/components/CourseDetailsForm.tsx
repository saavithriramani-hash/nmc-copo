'use client';

import { updateCourseDetailsAction, type CourseDetailsResult } from '@/actions/course';
import { useServerAction } from './useServerAction';

/**
 * The course catalogue entry (CR-3: the Controller of Examinations').
 *
 * A client component only so the save can say something. As a plain
 * server-action form it gave no sign at all: no pending state, no
 * confirmation, and — worse — its failures were reported by redirecting
 * to `?error=`, which in a production build leaves the content area
 * blank. The refusal to reclassify a course that already has external
 * marks would have been invisible exactly when it mattered.
 *
 * `useServerAction` keeps the button honest without letting the page
 * refresh hold it hostage; see that hook for why the two are separated.
 */
export function CourseDetailsForm({
  courseId,
  canWrite,
  course,
}: {
  courseId: string;
  canWrite: boolean;
  course: { code: string; title: string; semester: number; credits: string | null; isLaboratory: boolean };
}) {
  const action = updateCourseDetailsAction.bind(null, courseId);
  const { result, pending, onSubmit } = useServerAction<CourseDetailsResult>(action);

  return (
    <div className="space-y-1">
      {/*
        Flex rather than a two-column grid: every field is sized to what
        it actually holds, and the button sits directly after the last one
        instead of being pushed to the far side of a column it never
        needed. The card is only as wide as the longest field.
      */}
      <form
        onSubmit={onSubmit}
        className="bg-white border border-gray-300 rounded p-4 flex flex-wrap items-end gap-x-3 gap-y-2 max-w-xl"
      >
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Code</span>
          <input name="code" defaultValue={course.code} required disabled={!canWrite} className="w-40 border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Semester</span>
          {/* One or two digits. A wide box invites the reader to expect a
              long value. */}
          <input name="semester" type="number" min={1} max={12} defaultValue={course.semester} required disabled={!canWrite} className="w-16 border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Credits</span>
          {/* Wider than Semester only because it takes halves: "4.5". */}
          <input name="credits" type="number" step="0.5" min={0} defaultValue={course.credits ?? ''} disabled={!canWrite} className="w-20 border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
        </label>
        {/* `w-full` breaks the line: the title is the one free-text field
            and gets the row to itself. */}
        <label className="block w-full">
          <span className="block text-xs font-medium text-gray-700 mb-1">Title</span>
          <input name="title" defaultValue={course.title} required disabled={!canWrite} className="w-full border border-gray-300 rounded px-2 py-1.5 disabled:bg-gray-100" />
        </label>
        {/*
          CR-3. A practical paper's external examination is conducted by
          the department, so this flag hands that assessment and its marks
          to the HoD and the course faculty instead of the COE. It changes
          no arithmetic.
        */}
        <label className="flex items-center gap-2 w-full">
          <input type="checkbox" name="isLaboratory" defaultChecked={course.isLaboratory} disabled={!canWrite} className="h-4 w-4" />
          <span className="text-xs text-gray-700">
            Laboratory course — the department sets and marks its practical examination
          </span>
        </label>
        {canWrite ? (
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending || undefined}
            className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? 'Saving…' : 'Save details'}
          </button>
        ) : null}
      </form>

      {/* role="status" / role="alert": the page does not move when a save
          lands, so a screen reader would otherwise miss it entirely. */}
      {result?.error ? (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {result.error}
        </p>
      ) : result?.ok ? (
        <p role="status" className="text-xs text-green-800">
          Saved.
        </p>
      ) : null}
    </div>
  );
}
