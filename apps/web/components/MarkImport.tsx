'use client';

import { useState, useTransition } from 'react';
import { commitMarkImportAction, previewMarkImportAction, type MarkImportPreview } from '@/actions/marks';

const fmt = (value: number | null) => (value === null ? 'blank' : String(value));

/**
 * Paste or upload one assessment's marks (FR-12), matched on register
 * number, with EVERY change previewed (old → new) before anything is
 * written. Empty cells import as blank, shown as a change like any other.
 */
export function MarkImport({
  courseId,
  assessmentId,
  onApplied,
}: {
  courseId: string;
  assessmentId: string;
  /** Called with the number applied; the parent closes this panel, so the
   *  confirmation has to be shown there rather than here. */
  onApplied: (applied: number) => void;
}) {
  const [pasted, setPasted] = useState('');
  const [preview, setPreview] = useState<MarkImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const runPastePreview = () =>
    startTransition(async () => {
      setMessage(null);
      setPreview(await previewMarkImportAction(assessmentId, { pasted }));
    });
  const runFilePreview = (formData: FormData) =>
    startTransition(async () => {
      setMessage(null);
      setPreview(await previewMarkImportAction(assessmentId, { formData }));
    });

  const apply = () => {
    if (!preview?.plan) return;
    startTransition(async () => {
      const changes = preview.plan!.changes.map((c) => ({ enrolmentId: c.enrolmentId, itemId: c.itemId, value: c.newValue }));
      const result = await commitMarkImportAction(assessmentId, changes);
      if (result.ok) {
        setPreview(null);
        setPasted('');
        onApplied(result.applied ?? 0);
      } else {
        setMessage(result.error ?? 'Some cells were rejected.');
      }
    });
  };

  const plan = preview?.plan;

  return (
    <div className="bg-white border border-gray-300 rounded p-4 space-y-3">
      <h3 className="font-medium">Paste or upload marks</h3>
      <p className="text-xs text-gray-600">
        A header row with the register-number column and one column per item label, then a row per student. Matched on
        register number; every change is previewed before it is applied.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 space-y-1">
        <a
          href={`/api/courses/${courseId}/assessments/${assessmentId}/template`}
          className="text-blue-700 hover:underline font-medium text-sm"
        >
          ↓ Download the mark sheet for this assessment
        </a>
        <p className="text-xs text-gray-700">
          Every enrolled student and every question, carrying whatever marks are already recorded — so you can fill in
          the rest and upload it without disturbing them. <b>Leave a cell empty if the student did not attempt that
          question</b>: an empty cell and a 0 are not the same thing, and clearing a cell will clear that mark.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Paste from a spreadsheet</label>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder={'Register No\tQ1\tQ2\n24MAT001\t2\t5\n24MAT002\t1\t'}
            className="w-full border border-gray-300 rounded px-2 py-1 font-mono text-xs"
          />
          <button type="button" onClick={runPastePreview} disabled={pending || pasted.trim() === ''} className="border border-gray-300 rounded px-3 py-1 hover:bg-gray-100 disabled:opacity-50">
            Preview pasted marks
          </button>
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-700">Or upload a file</label>
          <form action={runFilePreview} className="flex items-center gap-2">
            <input type="file" name="file" accept=".csv,.xlsx,.xlsm,text/csv" required className="text-xs" />
            <button type="submit" disabled={pending} className="border border-gray-300 rounded px-3 py-1 hover:bg-gray-100 disabled:opacity-50">Preview file</button>
          </form>
        </div>
      </div>

      {message ? <p className="text-sm text-gray-800 bg-gray-100 border border-gray-200 rounded px-3 py-2">{message}</p> : null}
      {preview && !preview.ok ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{preview.error}</p> : null}

      {plan ? (
        <div className="space-y-2 border-t border-gray-200 pt-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-blue-800">{plan.changes.length} change(s)</span>
            <span className="text-gray-600">{plan.unchanged} unchanged</span>
            {plan.invalid.length > 0 ? <span className="text-red-700 font-medium">{plan.invalid.length} invalid</span> : null}
            {plan.unmatchedRegisterNumbers.length > 0 ? <span className="text-amber-800">{plan.unmatchedRegisterNumbers.length} unmatched register no.</span> : null}
            {plan.unknownColumns.length > 0 ? <span className="text-amber-800">{plan.unknownColumns.length} unknown column(s)</span> : null}
          </div>

          {plan.unmatchedRegisterNumbers.length > 0 ? (
            <p className="text-xs text-amber-800">Not enrolled (skipped): {plan.unmatchedRegisterNumbers.join(', ')}</p>
          ) : null}
          {plan.unknownColumns.length > 0 ? (
            <p className="text-xs text-amber-800">Columns not matching any item (ignored): {plan.unknownColumns.join(', ')}</p>
          ) : null}
          {plan.missingColumns.length > 0 ? (
            <p className="text-xs text-gray-600">Items not in the file (left as-is): {plan.missingColumns.join(', ')}</p>
          ) : null}
          {plan.invalid.length > 0 ? (
            <div className="text-xs text-red-700 max-h-28 overflow-y-auto border border-red-200 rounded p-2">
              {plan.invalid.map((inv, i) => (
                <div key={i}>{inv.registerNumber} · {inv.itemLabel}: “{inv.raw}” — {inv.reason}</div>
              ))}
            </div>
          ) : null}

          {plan.changes.length > 0 ? (
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100">
                  <tr className="text-left">
                    <th className="border border-gray-300 px-2 py-1">Register no.</th>
                    <th className="border border-gray-300 px-2 py-1">Student</th>
                    <th className="border border-gray-300 px-2 py-1">Item</th>
                    <th className="border border-gray-300 px-2 py-1 text-center">Old</th>
                    <th className="border border-gray-300 px-2 py-1 text-center">New</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.changes.map((change, i) => (
                    <tr key={i}>
                      <td className="border border-gray-300 px-2 py-1 font-mono">{change.registerNumber}</td>
                      <td className="border border-gray-300 px-2 py-1">{change.studentName}</td>
                      <td className="border border-gray-300 px-2 py-1">{change.itemLabel}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center text-gray-500">{fmt(change.oldValue)}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center font-medium text-blue-800">{fmt(change.newValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No changes to apply.</p>
          )}

          {plan.changes.length > 0 ? (
            <button type="button" onClick={apply} disabled={pending} className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50">
              {pending ? 'Applying…' : `Apply ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
