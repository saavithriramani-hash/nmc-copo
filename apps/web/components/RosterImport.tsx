'use client';

import { useState, useTransition } from 'react';
import { commitRosterImportAction, previewRosterImportAction, type RosterPreview } from '@/actions/roster';

/**
 * Roster import (FR-10): choose a CSV/Excel file → PREVIEW exactly what
 * will be created (nothing written yet) → confirm. The two-step flow
 * means faculty always see the outcome before committing.
 */
export function RosterImport({ batchId }: { batchId: string }) {
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const runPreview = (formData: FormData) =>
    startTransition(async () => {
      setDone(null);
      setPreview(await previewRosterImportAction(batchId, formData));
    });

  const commit = () => {
    if (!preview?.toCreate) return;
    startTransition(async () => {
      const result = await commitRosterImportAction(batchId, preview.toCreate!);
      if (result.ok) {
        setDone(`Imported ${result.created} student${result.created === 1 ? '' : 's'}.`);
        setPreview(null);
      } else {
        setPreview({ ...preview, error: result.error });
      }
    });
  };

  return (
    <div className="bg-white border border-gray-300 rounded p-4 space-y-3">
      <h3 className="font-medium">Import roster from Excel or CSV</h3>
      <p className="text-xs text-gray-600">
        Columns: register number, name, and an optional email — with or without a header row. You will see a preview
        before anything is saved.
      </p>
      <form action={runPreview} className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,.xlsx,.xlsm,text/csv" required className="text-sm" />
        <button type="submit" disabled={pending} className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50">
          {pending ? 'Reading…' : 'Preview'}
        </button>
        {/* Same offer, in the same place, as the account importer. */}
        <a href={`/api/batches/${batchId}/roster/template`} className="text-xs text-blue-700 hover:underline">
          Download a blank template
        </a>
      </form>

      {done ? <p className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{done}</p> : null}

      {preview?.error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{preview.error}</p> : null}

      {preview?.ok ? (
        <div className="space-y-3 border-t border-gray-200 pt-3">
          <p className="text-xs text-gray-600">
            {preview.fileName} · {preview.headerDetected ? 'header row detected' : 'no header — positional columns'} ·
            register no. = column {preview.columns?.registerNumber}, name = column {preview.columns?.fullName}
            {preview.columns?.email ? `, email = column ${preview.columns.email}` : ''}
          </p>

          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-green-800 font-medium">{preview.toCreate?.length ?? 0} new to create</span>
            <span className="text-gray-600">{preview.alreadyPresent?.length ?? 0} already on roster (unchanged)</span>
            <span className={preview.parseErrors && preview.parseErrors.length > 0 ? 'text-red-700 font-medium' : 'text-gray-600'}>
              {preview.parseErrors?.length ?? 0} row error(s)
            </span>
          </div>

          {preview.parseErrors && preview.parseErrors.length > 0 ? (
            <div className="text-xs text-red-700 max-h-32 overflow-y-auto border border-red-200 rounded p-2">
              {preview.parseErrors.map((e, i) => (
                <div key={i}>Row {e.row}: {e.message}</div>
              ))}
            </div>
          ) : null}

          {preview.toCreate && preview.toCreate.length > 0 ? (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100">
                  <tr className="text-left">
                    <th className="border border-gray-300 px-2 py-1">Register no.</th>
                    <th className="border border-gray-300 px-2 py-1">Name</th>
                    <th className="border border-gray-300 px-2 py-1">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.toCreate.map((entry) => (
                    <tr key={entry.registerNumber}>
                      <td className="border border-gray-300 px-2 py-1 font-mono">{entry.registerNumber}</td>
                      <td className="border border-gray-300 px-2 py-1">{entry.fullName}</td>
                      <td className="border border-gray-300 px-2 py-1 text-gray-600">{entry.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.toCreate && preview.toCreate.length > 0 ? (
            <button type="button" onClick={commit} disabled={pending} className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50">
              {pending ? 'Importing…' : `Import ${preview.toCreate.length} student${preview.toCreate.length === 1 ? '' : 's'}`}
            </button>
          ) : (
            <p className="text-sm text-gray-600">Nothing new to import.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
