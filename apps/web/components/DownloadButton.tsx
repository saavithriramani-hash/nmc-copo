'use client';

import { useState } from 'react';

/**
 * A download that says it is working.
 *
 * The course report and the Excel workbook are generated on request —
 * the PDF renders every section and the workbook writes a live formula
 * for each derived cell — so a plain anchor leaves several seconds in
 * which nothing at all appears to happen, and the usual response is to
 * click again and start a second render.
 *
 * Fetching the file ourselves (rather than letting the browser navigate)
 * is what makes the pending state honest: we know when the bytes have
 * actually arrived, instead of guessing with a timer. The filename comes
 * from the response's own Content-Disposition, so downloads are named
 * exactly as the API intended.
 */
export function DownloadButton({
  href,
  label,
  fallbackName,
}: {
  href: string;
  label: string;
  /** Used only if the response omits a Content-Disposition filename. */
  fallbackName: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(href);
      if (!response.ok) {
        // The API guards each of these routes; a denial arrives as a
        // status, not an exception, and must not look like success.
        setError(response.status === 403 || response.status === 404 ? 'Not available to you.' : `Failed (${response.status}).`);
        return;
      }

      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setError('Could not download.');
    } finally {
      // Revoked later, not immediately: Safari cancels the download if
      // the object URL disappears in the same frame as the click.
      const created = objectUrl;
      if (created) setTimeout(() => URL.revokeObjectURL(created), 10_000);
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={download}
        disabled={pending}
        aria-busy={pending || undefined}
        className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-60 inline-flex items-center gap-1.5"
      >
        {pending ? (
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-blue-700 animate-spin"
          />
        ) : null}
        {pending ? 'Preparing…' : label}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
