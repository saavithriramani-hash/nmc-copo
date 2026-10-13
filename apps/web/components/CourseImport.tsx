'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { commitCourseImportAction, previewCourseImportAction, type CourseImportPreview } from '@/actions/courseImport';

/**
 * Bulk course import (CR-11): choose a file → PREVIEW exactly what will
 * be created (nothing written yet) → confirm. The same file is sent again
 * on confirm and re-checked on the server, so what is created is what
 * the file says now, not what the preview said.
 *
 * Confirm is offered only for a clean file: any row error blocks the
 * whole import, so the catalogue is never half-imported.
 */
export function CourseImport() {
  const [preview, setPreview] = useState<CourseImportPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileData = useRef<FormData | null>(null);

  const runPreview = (formData: FormData) =>
    startTransition(async () => {
      setDone(null);
      fileData.current = formData;
      setPreview(await previewCourseImportAction(formData));
    });

  const commit = () => {
    const formData = fileData.current;
    if (!formData) return;
    startTransition(async () => {
      const result = await commitCourseImportAction(formData);
      if (result.ok) {
        setDone(
          `Created ${result.created} course${result.created === 1 ? '' : 's'}` +
            (result.skipped > 0 ? `; ${result.skipped} already existed and were left unchanged.` : '.'),
        );
        setPreview(null);
        fileData.current = null;
      } else {
        setPreview({ ok: false, error: result.error });
      }
    });
  };

  return (
    <div className="bg-white border border-gray-300 rounded p-4 space-y-3">
      <p className="text-sm text-gray-700">
        Start from the template: its Batch column is a dropdown of every batch, and Excel checks the semester, credits
        and Laboratory columns as you type. A CSV with the same columns works too. You will see a preview before anything
        is saved.
      </p>
      <form action={runPreview} className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,.xlsx,.xlsm,text/csv" required className="text-sm" />
        <button
          type="submit"
          disabled={pending}
          className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
        >
          {pending && !preview ? 'Reading…' : 'Preview'}
        </button>
        <a href="/api/courses/import/template" className="text-xs text-blue-700 hover:underline">
          Download the template
        </a>
      </form>

      {done ? (
        <p className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
          {done}{' '}
          <Link href="/courses" className="text-blue-700 hover:underline">
            Back to courses
          </Link>
        </p>
      ) : null}

      {preview && !preview.ok ? (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{preview.error}</p>
      ) : null}

      {preview?.ok ? (
        <div className="space-y-3 border-t border-gray-200 pt-3">
          <p className="text-xs text-gray-600">
            {preview.fileName} · {preview.headerDetected ? 'header row detected' : 'no header — columns read in template order'}
          </p>

          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-green-800 font-medium">{preview.toCreate.length} to create</span>
            <span className="text-gray-600">{preview.alreadyExists.length} already exist (left unchanged)</span>
            <span className={preview.errors.length > 0 ? 'text-red-700 font-medium' : 'text-gray-600'}>
              {preview.errors.length} row error{preview.errors.length === 1 ? '' : 's'}
            </span>
          </div>

          {preview.errors.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm text-red-800">Nothing will be created until every row below is fixed. Correct the file and preview it again.</p>
              <div className="text-xs text-red-700 max-h-48 overflow-y-auto border border-red-200 rounded p-2">
                {preview.errors.map((e, i) => (
                  <div key={i}>
                    Row {e.row}: {e.message}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {preview.toCreate.length > 0 ? (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full bg-white border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="border border-gray-300 px-2 py-1 w-14">Row</th>
                    <th className="border border-gray-300 px-2 py-1">Batch</th>
                    <th className="border border-gray-300 px-2 py-1">Code</th>
                    <th className="border border-gray-300 px-2 py-1">Title</th>
                    <th className="border border-gray-300 px-2 py-1 w-14">Sem</th>
                    <th className="border border-gray-300 px-2 py-1 w-16">Credits</th>
                    <th className="border border-gray-300 px-2 py-1 w-14">Lab</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.toCreate.map((row) => (
                    <tr key={row.sourceRow}>
                      <td className="border border-gray-300 px-2 py-1 text-gray-500">{row.sourceRow}</td>
                      <td className="border border-gray-300 px-2 py-1 text-xs">{row.batchLabel}</td>
                      <td className="border border-gray-300 px-2 py-1 font-medium">{row.code}</td>
                      <td className="border border-gray-300 px-2 py-1">{row.title}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center">{row.semester}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center">{row.credits ?? '—'}</td>
                      <td className="border border-gray-300 px-2 py-1 text-center">{row.isLaboratory ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {preview.alreadyExists.length > 0 ? (
            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer">Show the {preview.alreadyExists.length} that already exist</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.alreadyExists.map((row) => (
                  <li key={row.sourceRow}>
                    Row {row.sourceRow}: {row.code} — {row.batchLabel}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <button
            type="button"
            onClick={commit}
            disabled={pending || !preview.canCommit}
            className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
          >
            {pending ? 'Creating…' : `Create ${preview.toCreate.length} course${preview.toCreate.length === 1 ? '' : 's'}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
