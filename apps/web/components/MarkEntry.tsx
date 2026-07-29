'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MarkGrid, type GridColumn, type GridMark, type GridStudent } from './MarkGrid';
import { MarkImport } from './MarkImport';

/**
 * Client shell for one assessment's mark entry: the grid, plus a
 * collapsible paste/upload panel. Kept apart from the server page so the
 * page can stay a fast server component that just loads data.
 */
export function MarkEntry({
  courseId,
  assessmentId,
  students,
  columns,
  initial,
  canEdit,
}: {
  courseId: string;
  assessmentId: string;
  students: GridStudent[];
  columns: GridColumn[];
  initial: GridMark[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  // Applying closes the import panel, so the confirmation lives here —
  // otherwise it unmounts with the panel and is never seen.
  const [applied, setApplied] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {applied !== null ? (
        <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
          Applied {applied} change{applied === 1 ? '' : 's'} from the uploaded file. The grid below now shows them.
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setApplied(null);
              setShowImport((v) => !v);
            }}
            className="text-sm border border-gray-300 rounded px-3 py-1 hover:bg-gray-100"
          >
            {showImport ? 'Hide paste / upload' : 'Paste or upload marks'}
          </button>
        </div>
      ) : null}
      {showImport ? (
        <MarkImport
          courseId={courseId}
          assessmentId={assessmentId}
          onApplied={(count) => {
            setShowImport(false);
            setApplied(count);
            router.refresh(); // reload the grid with the applied marks
          }}
        />
      ) : null}
      <MarkGrid assessmentId={assessmentId} students={students} columns={columns} initial={initial} canEdit={canEdit} />
    </div>
  );
}
