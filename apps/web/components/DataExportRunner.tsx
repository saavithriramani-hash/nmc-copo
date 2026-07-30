'use client';

import { useEffect, useRef, useState } from 'react';
import { getJobStatusAction, startInstitutionalExportAction, type JobStatusView } from '@/actions/jobs';

/**
 * Full institutional export (NFR-12), on demand. Every table as CSV plus
 * a manifest, in a ZIP — open formats the college can read with anything.
 */
export function DataExportRunner() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = async () => {
    setBusy(true);
    setStatus(null);
    const { jobId: id } = await startInstitutionalExportAction();
    setJobId(id);
    setBusy(false);
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      const next = await getJobStatusAction(jobId);
      if (cancelled) return;
      setStatus(next);
      if (next && (next.status === 'PENDING' || next.status === 'RUNNING')) timer.current = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId]);

  const running = status?.status === 'PENDING' || status?.status === 'RUNNING';

  return (
    <section className="border border-gray-300 rounded bg-white p-4 space-y-3">
      <h2 className="font-medium">Full institutional data export</h2>
      <p className="text-xs text-gray-600 max-w-3xl">
        Every table as a CSV file (UTF-8, RFC 4180) with a JSON manifest and a README, in one ZIP. Open formats, readable
        by any spreadsheet or database — the college is never locked into this software. Passwords are not included.
      </p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy || running}
        className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
      >
        {running ? 'Exporting…' : busy ? 'Starting…' : 'Export all data'}
      </button>

      {running ? (
        <div className="max-w-md">
          <div className="h-3 bg-gray-200 rounded overflow-hidden" role="progressbar" aria-valuenow={status?.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${status?.progress ?? 0}%` }} />
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {status?.progress ?? 0}% · {status?.progressNote ?? 'Working…'}
          </p>
        </div>
      ) : null}

      {status?.status === 'FAILED' ? (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 text-sm">Export failed: {status.error}</p>
      ) : null}

      {status?.status === 'COMPLETED' && status.bundle ? (
        <div className="text-green-900 bg-green-50 border border-green-200 rounded px-3 py-2 space-y-1">
          <p className="text-sm">
            Export ready — {status.bundle.courseCount} table(s), {(status.bundle.byteLength / 1024 / 1024).toFixed(1)} MB.
          </p>
          <a href={`/api/exports/${jobId}`} className="inline-block bg-green-700 text-white rounded px-3 py-1.5 hover:bg-green-800">
            Download {status.bundle.fileName}
          </a>
        </div>
      ) : null}
    </section>
  );
}
