'use client';

import { useState, useTransition } from 'react';
import {
  commitCourseMarkImportAction,
  previewCourseMarkImportAction,
  type CourseMarkImportPreview,
} from '@/actions/marks';

/**
 * Download one workbook for the whole course, fill in any or all of its
 * sheets, upload it back (FR-12).
 *
 * Two-step like every other import here: preview exactly what would
 * change, then confirm. The preview groups by assessment, because a
 * course-wide upload can carry thousands of changes and an undivided
 * list of them says nothing about which assessment moved.
 */
const ROWS_SHOWN_PER_SHEET = 8;

export function CourseMarkImport({ courseId }: { courseId: string }) {
  const [preview, setPreview] = useState<CourseMarkImportPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const runPreview = (formData: FormData) =>
    startTransition(async () => {
      setDone(null);
      setOpen(null);
      setPreview(await previewCourseMarkImportAction(courseId, formData));
    });

  const commit = () => {
    const plan = preview?.plan;
    if (!plan) return;
    startTransition(async () => {
      const result = await commitCourseMarkImportAction(
        courseId,
        plan.sheets.map((sheet) => ({
          assessmentId: sheet.assessmentId,
          cells: sheet.plan.changes.map((change) => ({
            enrolmentId: change.enrolmentId,
            itemId: change.itemId,
            value: change.newValue,
          })),
        })),
      );
      if (result.ok) {
        setDone(
          `Imported ${result.applied} mark${result.applied === 1 ? '' : 's'} across ${result.assessments} assessment${
            result.assessments === 1 ? '' : 's'
          }.`,
        );
        setPreview(null);
      } else {
        setPreview({ ...preview!, error: result.error });
      }
    });
  };

  const plan = preview?.plan;
  const blocked = plan ? plan.totals.invalid > 0 : false;
  // Sheets that actually CHANGE, not sheets that matched. Saying "across
  // 6 sheets" when two of them changed reads as six about to be written.
  const changedSheets = plan ? plan.sheets.filter((sheet) => sheet.plan.changes.length > 0).length : 0;

  return (
    <div className="bg-white border border-gray-300 rounded p-4 space-y-3">
      <h3 className="font-medium">All assessments in one file</h3>
      <p className="text-xs text-gray-600 max-w-3xl">
        Download one workbook with a sheet per assessment, carrying the marks already recorded. Fill in any or all of the
        sheets and upload it back. You will see every change before anything is stored, and the upload is applied in full
        or not at all.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/courses/${courseId}/marks/template`}
          className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 text-sm"
        >
          Download mark workbook
        </a>
        <form action={runPreview} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".xlsx,.xlsm" required className="text-sm" />
          <button
            type="submit"
            disabled={pending}
            className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
          >
            {pending ? 'Reading…' : 'Preview upload'}
          </button>
        </form>
      </div>

      {done ? <p className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{done}</p> : null}
      {preview?.error ? (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{preview.error}</p>
      ) : null}

      {plan ? (
        <div className="space-y-3 border-t border-gray-200 pt-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="font-medium text-blue-800">{plan.totals.changes} change(s)</span>
            <span className="text-gray-600">{plan.totals.unchanged} unchanged</span>
            <span className={plan.totals.invalid > 0 ? 'text-red-700 font-medium' : 'text-gray-600'}>
              {plan.totals.invalid} invalid cell(s)
            </span>
            <span className="text-gray-600">{plan.sheets.length} sheet(s) matched</span>
          </div>

          {/* Sheets that match nothing are reported, never guessed at: writing
              one assessment's marks onto another is the failure to avoid. */}
          {plan.unmatchedSheets.length > 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <span className="font-medium">Ignored {plan.unmatchedSheets.length} sheet(s)</span> matching no assessment
              in this course: {plan.unmatchedSheets.map((name) => `“${name}”`).join(', ')}. If an assessment was renamed
              after the workbook was downloaded, download it again — nothing is guessed.
            </p>
          ) : null}

          {plan.assessmentsWithoutSheet.length > 0 ? (
            <p className="text-xs text-gray-600">
              No sheet for {plan.assessmentsWithoutSheet.map((name) => `“${name}”`).join(', ')} — left untouched.
            </p>
          ) : null}

          {plan.totals.unmatchedRegisterNumbers.length > 0 ? (
            <p className="text-xs text-amber-800">
              {plan.totals.unmatchedRegisterNumbers.length} register number(s) in the file are not enrolled in this
              course and were skipped: {plan.totals.unmatchedRegisterNumbers.slice(0, 10).join(', ')}
              {plan.totals.unmatchedRegisterNumbers.length > 10 ? '…' : ''}
            </p>
          ) : null}

          <div className="border border-gray-200 rounded divide-y divide-gray-200">
            {plan.sheets.map((sheet) => {
              const count = sheet.plan.changes.length;
              const isOpen = open === sheet.assessmentId;
              return (
                <div key={sheet.assessmentId}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : sheet.assessmentId)}
                    className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50"
                    aria-expanded={isOpen}
                  >
                    <span className="font-medium">{sheet.assessmentName}</span>
                    <span className="text-xs text-gray-500">sheet “{sheet.sheetName}”</span>
                    <span className={count > 0 ? 'text-blue-800' : 'text-gray-500'}>{count} change(s)</span>
                    {sheet.plan.invalid.length > 0 ? (
                      <span className="text-red-700">{sheet.plan.invalid.length} invalid</span>
                    ) : null}
                    {sheet.plan.unknownColumns.length > 0 ? (
                      <span className="text-amber-800">{sheet.plan.unknownColumns.length} unknown column(s)</span>
                    ) : null}
                    {sheet.plan.missingColumns.length > 0 ? (
                      <span className="text-amber-800">{sheet.plan.missingColumns.length} column(s) missing</span>
                    ) : null}
                    <span className="ml-auto text-xs text-gray-500">{isOpen ? 'hide' : 'show'}</span>
                  </button>

                  {isOpen ? (
                    <div className="px-3 pb-3 space-y-2">
                      {sheet.plan.invalid.length > 0 ? (
                        <div className="text-xs text-red-700 border border-red-200 rounded p-2 max-h-32 overflow-y-auto">
                          {sheet.plan.invalid.map((bad, i) => (
                            <div key={i}>
                              {bad.registerNumber} · {bad.itemLabel}: “{bad.raw}” — {bad.reason}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {count === 0 ? (
                        <p className="text-xs text-gray-500">Nothing changed on this sheet.</p>
                      ) : (
                        <table className="w-full border-collapse text-xs">
                          <thead className="bg-gray-100 text-left">
                            <tr>
                              <th className="border border-gray-300 px-2 py-1">Register no.</th>
                              <th className="border border-gray-300 px-2 py-1">Student</th>
                              <th className="border border-gray-300 px-2 py-1">Question</th>
                              <th className="border border-gray-300 px-2 py-1">Was</th>
                              <th className="border border-gray-300 px-2 py-1">Becomes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sheet.plan.changes.slice(0, ROWS_SHOWN_PER_SHEET).map((change, i) => (
                              <tr key={i}>
                                <td className="border border-gray-300 px-2 py-1 font-mono">{change.registerNumber}</td>
                                <td className="border border-gray-300 px-2 py-1">{change.studentName}</td>
                                <td className="border border-gray-300 px-2 py-1">{change.itemLabel}</td>
                                {/* "blank" spelled out on both sides: it is a
                                    fact of its own, not an absence of one. */}
                                <td className="border border-gray-300 px-2 py-1 text-gray-600">
                                  {change.oldValue === null ? 'blank' : change.oldValue}
                                </td>
                                <td className="border border-gray-300 px-2 py-1 font-medium">
                                  {change.newValue === null ? 'blank' : change.newValue}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {count > ROWS_SHOWN_PER_SHEET ? (
                        <p className="text-xs text-gray-500">…and {count - ROWS_SHOWN_PER_SHEET} more on this sheet.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {blocked ? (
            <p className="text-sm text-red-700">
              Fix the invalid cells in the workbook and upload it again — the import is applied in full or not at all.
            </p>
          ) : plan.totals.changes > 0 ? (
            <button
              type="button"
              onClick={commit}
              disabled={pending}
              className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
            >
              {pending ? 'Importing…' : `Import ${plan.totals.changes} mark(s) across ${changedSheets} sheet(s)`}
            </button>
          ) : (
            <p className="text-sm text-gray-600">Nothing to import — the workbook matches what is already recorded.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
