'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { previewBulkAccountsAction, type BulkAccountsPreview } from '@/actions/bulkAccounts';
import { MAX_IMPORT_ROWS } from '@/lib/bulkAccounts';

/**
 * Bulk account creation (§2.1), two-step like the roster import: choose
 * a file, see exactly what will happen, then confirm.
 *
 * Confirming posts the SAME FILE to /api/admin/accounts/bulk, which
 * creates the accounts and returns the handover slips as its response
 * body. The download is therefore not a convenience — it is the only
 * copy of those passwords that will ever exist, which is why the button
 * says so and why the panel refuses to quietly disappear afterwards.
 */
export function BulkAccountImport() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkAccountsPreview | null>(null);
  const [previewing, startPreview] = useTransition();
  const [committing, setCommitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setOutcome(null);
    setError(null);
  };

  function choose(next: File | null) {
    setFile(next);
    reset();
  }

  function runPreview() {
    if (!file) return;
    reset();
    startPreview(async () => {
      const formData = new FormData();
      formData.set('file', file);
      setPreview(await previewBulkAccountsAction(formData));
    });
  }

  async function commit() {
    if (!file) return;
    setCommitting(true);
    setError(null);
    let objectUrl: string | null = null;
    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch('/api/admin/accounts/bulk', { method: 'POST', body: formData });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `The import failed (${response.status}). No accounts were created.`);
        return;
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `Account-slips_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      const created = response.headers.get('X-Import-Created') ?? '?';
      const skipped = response.headers.get('X-Import-Skipped') ?? '0';
      const rejected = response.headers.get('X-Import-Rejected') ?? '0';
      setOutcome(
        `${created} account(s) created · ${skipped} already registered · ${rejected} row(s) rejected. The slips have been downloaded — they cannot be produced again.`,
      );
      setPreview(null);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check the account list before trying again — some accounts may have been created.');
    } finally {
      const created = objectUrl;
      if (created) setTimeout(() => URL.revokeObjectURL(created), 10_000);
      setCommitting(false);
    }
  }

  const ready = preview?.ok === true && preview.toCreate.length > 0;

  return (
    <section className="bg-white border border-gray-300 rounded p-4 space-y-3">
      <div>
        <h2 className="font-medium">Import accounts from a file</h2>
        <p className="text-xs text-gray-600 max-w-3xl">
          Columns: <strong>Full name</strong>, <strong>Email</strong>, and an optional <strong>Role</strong> that may
          only say “Faculty”. Every other role is granted individually below, so a mistyped column cannot hand out
          institution-wide access. Up to {MAX_IMPORT_ROWS} accounts per file; addresses that already exist are skipped,
          never overwritten.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
          className="text-xs"
        />
        <button
          type="button"
          onClick={runPreview}
          disabled={!file || previewing}
          className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
        >
          {previewing ? 'Reading…' : 'Preview'}
        </button>
        <a href="/api/admin/accounts/template" className="text-xs text-blue-700 hover:underline">
          Download a blank template
        </a>
      </div>

      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      ) : null}

      {outcome ? (
        <div className="border-2 border-green-600 bg-green-50 rounded px-3 py-2 space-y-1">
          <p className="text-sm text-green-900 font-medium">{outcome}</p>
          <p className="text-xs text-green-900">
            Hand each slip over in person, then destroy the sheet. If one is lost, use “Reset password” on that account
            rather than importing again.
          </p>
        </div>
      ) : null}

      {preview && !preview.ok ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{preview.error}</p>
      ) : null}

      {preview?.ok ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{preview.fileName}</span> — {preview.summary}
            {preview.headerDetected ? null : (
              <span className="text-xs text-amber-800"> · no header row found, columns read by position</span>
            )}
          </p>

          {preview.toCreate.length > 0 ? (
            <details open className="border border-gray-300 rounded">
              <summary className="cursor-pointer px-2 py-1 bg-gray-100 text-sm">
                Will be created ({preview.toCreate.length})
              </summary>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="border-t border-gray-300 px-2 py-1 w-16">Row</th>
                    <th className="border-t border-gray-300 px-2 py-1">Name</th>
                    <th className="border-t border-gray-300 px-2 py-1">Email</th>
                    <th className="border-t border-gray-300 px-2 py-1 w-24">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.toCreate.map((row) => (
                    <tr key={row.email}>
                      <td className="border-t border-gray-200 px-2 py-1 text-gray-500">{row.sourceRow}</td>
                      <td className="border-t border-gray-200 px-2 py-1">{row.fullName}</td>
                      <td className="border-t border-gray-200 px-2 py-1">{row.email}</td>
                      <td className="border-t border-gray-200 px-2 py-1">{row.grantFaculty ? 'Faculty' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}

          {preview.skipped.length > 0 ? (
            <details className="border border-gray-300 rounded">
              <summary className="cursor-pointer px-2 py-1 bg-gray-100 text-sm">
                Already registered — left untouched ({preview.skipped.length})
              </summary>
              <ul className="px-3 py-2 text-xs space-y-0.5">
                {preview.skipped.map((entry) => (
                  <li key={entry.row.email}>
                    <span className="font-medium">{entry.row.email}</span> — {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {preview.parseErrors.length > 0 ? (
            <details open className="border-2 border-amber-400 rounded bg-amber-50">
              <summary className="cursor-pointer px-2 py-1 text-sm font-medium text-amber-900">
                Rejected — no account will be created ({preview.parseErrors.length})
              </summary>
              <ul className="px-3 py-2 text-xs space-y-0.5 text-amber-900">
                {preview.parseErrors.map((problem, i) => (
                  <li key={`${problem.row}-${i}`}>
                    Row {problem.row}: {problem.message}
                  </li>
                ))}
              </ul>
              <p className="px-3 pb-2 text-xs text-amber-900">
                You can import the rest now and correct these afterwards — re-running the corrected file skips whatever
                already exists.
              </p>
            </details>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={commit}
              disabled={!ready || committing}
              className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
            >
              {committing
                ? 'Creating accounts…'
                : `Create ${preview.toCreate.length} account${preview.toCreate.length === 1 ? '' : 's'} and download the slips`}
            </button>
            <button
              type="button"
              onClick={() => {
                choose(null);
                if (fileInput.current) fileInput.current.value = '';
              }}
              className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100"
            >
              Cancel
            </button>
            {ready ? (
              <span className="text-xs text-gray-600">
                The passwords are shown once, in the PDF this produces. They are not stored anywhere.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
