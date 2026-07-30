'use client';

import { useEffect, useRef, useState } from 'react';
import { getJobStatusAction, restartBundleAction, startBundleAction, type JobStatusView } from '@/actions/jobs';

/**
 * The accreditation bundle (FR-22): one export containing every course
 * report, the consolidations and the procedure appendix. It runs in the
 * background with a progress indicator, and a failed run can be
 * restarted — the reports already written are kept, so it resumes.
 */
export function BundleRunner() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatusView | null>(null);
  const [semester, setSemester] = useState('');
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    setStatus(null);
    const filter = {
      ...(semester.trim() !== '' ? { semester: Number(semester) } : {}),
      ...(batch.trim() !== '' ? { batchName: batch.trim() } : {}),
    };
    const { jobId: id } = await startBundleAction(filter);
    setJobId(id);
    setBusy(false);
  };

  const restart = async () => {
    if (!jobId) return;
    setBusy(true);
    const result = await restartBundleAction(jobId);
    setMessage(result.ok ? 'Restarted — the reports already produced are kept.' : (result.error ?? null));
    setBusy(false);
    if (result.ok) setStatus((current) => (current ? { ...current, status: 'RUNNING' } : current));
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      const next = await getJobStatusAction(jobId);
      if (cancelled) return;
      setStatus(next);
      if (next && (next.status === 'PENDING' || next.status === 'RUNNING')) {
        timer.current = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId, status?.status]);

  const running = status?.status === 'PENDING' || status?.status === 'RUNNING';

  return (
    <section className="border border-gray-300 rounded bg-white p-4 space-y-3">
      <h2 className="font-medium">Accreditation bundle</h2>
      <p className="text-xs text-gray-600 max-w-3xl">
        One ZIP containing a PDF report for every course, the programme and institution consolidations, and the
        procedure appendix populated with the parameters each course actually applied. It runs in the background; if it
        fails you can restart it and it resumes from the reports already produced.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Semester (optional)</span>
          <input value={semester} onChange={(e) => setSemester(e.target.value)} type="number" min={1} max={12} className="border border-gray-300 rounded px-2 py-1.5 w-28" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Batch (optional)</span>
          <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="2024–2027" className="border border-gray-300 rounded px-2 py-1.5 w-40" />
        </label>
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || running}
          className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
        >
          {running ? 'Building…' : busy ? 'Starting…' : 'Build bundle'}
        </button>
      </div>

      {running ? (
        <div className="max-w-md">
          <div className="h-3 bg-gray-200 rounded overflow-hidden" role="progressbar" aria-valuenow={status?.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${status?.progress ?? 0}%` }} />
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {status?.progress ?? 0}% · {status?.progressNote ?? 'Working…'} — you can leave this page.
          </p>
        </div>
      ) : null}

      {message ? <p className="text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-1">{message}</p> : null}

      {status?.status === 'FAILED' ? (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 space-y-2">
          <p className="text-sm">Bundle failed: {status.error}</p>
          <button type="button" onClick={() => void restart()} disabled={busy} className="border border-red-300 rounded px-3 py-1 hover:bg-red-100">
            Restart (keeps what was already produced)
          </button>
        </div>
      ) : null}

      {status?.status === 'COMPLETED' && status.bundle ? (
        <div className="text-green-900 bg-green-50 border border-green-200 rounded px-3 py-2 space-y-1">
          <p className="text-sm">
            Bundle ready — {status.bundle.courseCount} course report(s), {status.bundle.programmeCount} programme
            consolidation(s), {(status.bundle.byteLength / 1024 / 1024).toFixed(1)} MB.
            {status.bundle.skipped > 0 ? ` ${status.bundle.skipped} part(s) were reused from an earlier run.` : ''}
          </p>
          <a href={`/api/bundles/${jobId}`} className="inline-block bg-green-700 text-white rounded px-3 py-1.5 hover:bg-green-800">
            Download {status.bundle.fileName}
          </a>
        </div>
      ) : null}
    </section>
  );
}
