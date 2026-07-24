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
  assessmentId,
  students,
  columns,
  initial,
  canEdit,
}: {
  assessmentId: string;
  students: GridStudent[];
  columns: GridColumn[];
  initial: GridMark[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div>
          <button
            type="button"
            onClick={() => setShowImport((v) => !v)}
            className="text-sm border border-gray-300 rounded px-3 py-1 hover:bg-gray-100"
          >
            {showImport ? 'Hide paste / upload' : 'Paste or upload marks'}
          </button>
        </div>
      ) : null}
      {showImport ? (
        <MarkImport
          assessmentId={assessmentId}
          onApplied={() => {
            setShowImport(false);
            router.refresh(); // reload the grid with the applied marks
          }}
        />
      ) : null}
      <MarkGrid assessmentId={assessmentId} students={students} columns={columns} initial={initial} canEdit={canEdit} />
    </div>
  );
}
