'use client';

import { useEffect, useRef, useState } from 'react';
import { getJobStatusAction, startInstitutionConsolidationAction, startProgrammeConsolidationAction, type JobStatusView } from '@/actions/jobs';

const fmt = (value: number | null): string => (value === null ? '—' : value.toFixed(3));

/**
 * Consolidation (FR-20/FR-21) as a background job with a progress
 * indicator (NFR-2): starting it returns immediately with a job id, and
 * this component polls until the job completes. The request never blocks
 * on the computation.
 */
export function ConsolidationRunner({ scope }: { scope: { kind: 'programme'; programmeId: string } | { kind: 'institution' } }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatusView | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = async () => {
    setStarting(true);
    setStatus(null);
    const { jobId: id } = scope.kind === 'programme'
      ? await startProgrammeConsolidationAction(scope.programmeId)
      : await startInstitutionConsolidationAction();
    setJobId(id);
    setStarting(false);
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const poll = async () => {
      const next = await getJobStatusAction(jobId);
      if (cancelled) return;
      setStatus(next);
      if (next && (next.status === 'PENDING' || next.status === 'RUNNING')) {
        timer.current = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId]);

  const running = status?.status === 'PENDING' || status?.status === 'RUNNING';
  const result = status?.status === 'COMPLETED' ? status.result : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting || running}
          className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
        >
          {running ? 'Running…' : starting ? 'Starting…' : 'Run consolidation'}
        </button>
        {running ? (
          <span className="text-xs text-gray-600">
            {status?.progressNote ?? 'Working…'} — runs in the background; you can leave this page and come back.
          </span>
        ) : null}
      </div>

      {running ? (
        <div className="w-full max-w-md">
          <div className="h-3 bg-gray-200 rounded overflow-hidden" role="progressbar" aria-valuenow={status?.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${status?.progress ?? 0}%` }} />
          </div>
          <p className="text-xs text-gray-600 mt-1">{status?.progress ?? 0}%</p>
        </div>
      ) : null}

      {status?.status === 'FAILED' ? (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">Consolidation failed: {status.error}</p>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            {result.scopeLabel} · {result.courses.length} course(s) · generated {new Date(result.generatedAt).toLocaleString()}
          </p>
          <div className="overflow-x-auto">
            <table className="bg-white border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-1">Course</th>
                  {result.groupOf ? <th className="border border-gray-300 px-2 py-1">Programme</th> : null}
                  <th className="border border-gray-300 px-2 py-1">Sem</th>
                  {result.poCodes.map((code) => (
                    <th key={code} className="border border-gray-300 px-2 py-1 text-center">{code}</th>
                  ))}
                  <th className="border border-gray-300 px-2 py-1 text-center">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {result.courses.map((course) => (
                  <tr key={course.courseId} className={course.error ? 'bg-red-50' : ''}>
                    <td className="border border-gray-300 px-2 py-1">
                      <span className="font-medium">{course.code}</span> <span className="text-gray-600">{course.title}</span>
                      {course.error ? <div className="text-xs text-red-700">{course.error}</div> : null}
                    </td>
                    {result.groupOf ? <td className="border border-gray-300 px-2 py-1 text-xs">{result.groupOf[course.courseId] ?? ''}</td> : null}
                    <td className="border border-gray-300 px-2 py-1 text-center">{course.semester}</td>
                    {result.poCodes.map((code) => (
                      <td key={code} className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                        {fmt(course.po[code] ?? null)}
                      </td>
                    ))}
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      {course.warningCount > 0 ? <span className="text-amber-800">{course.warningCount}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-medium">
                  <td className="border border-gray-300 px-2 py-1" colSpan={result.groupOf ? 3 : 2}>
                    Mean across courses with a value
                  </td>
                  {result.poCodes.map((code) => (
                    <td key={code} className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                      {fmt(result.means[code]?.mean ?? null)}
                      <div className="text-[10px] font-normal text-gray-500">n={result.means[code]?.n ?? 0}</div>
                    </td>
                  ))}
                  <td className="border border-gray-300 px-2 py-1"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Each cell is that course&apos;s official PO figure (Procedure Step 10). The mean is a plain arithmetic mean
            over the courses that produced a value — courses with no value are excluded, never counted as zero. The
            Procedure defines no cross-course formula, so nothing else is inferred here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
