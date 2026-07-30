import { redirect } from 'next/navigation';
import { collectHealth } from '@/lib/health';
import { formatBytes, type Level } from '@/lib/healthRules';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STYLE: Record<Level, { badge: string; row: string; word: string }> = {
  ok: { badge: 'bg-green-700', row: 'bg-green-50 border-green-200', word: 'OK' },
  warn: { badge: 'bg-amber-600', row: 'bg-amber-50 border-amber-200', word: 'ATTENTION' },
  fail: { badge: 'bg-red-700', row: 'bg-red-50 border-red-200', word: 'PROBLEM' },
};

/**
 * System health, written for whoever is on duty — not for a specialist.
 * Every problem states what to do about it, and names the exact command.
 */
export default async function HealthPage() {
  const user = await requireSession();
  const mayView = user.isAdmin || user.roles.some((role) => role.kind === 'IQAC' || role.kind === 'PRINCIPAL');
  if (!mayView) redirect('/');

  const report = await collectHealth();
  const overall = STYLE[report.level];

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">System health</h1>
        <span className={`text-white text-xs font-bold rounded px-2 py-1 ${overall.badge}`}>{overall.word}</span>
        <span className="text-xs text-gray-600 ml-auto">
          Checked {new Date(report.checkedAt).toLocaleString()} · this page re-checks on every visit
        </span>
      </div>

      {report.level === 'ok' ? (
        <p className="text-sm text-green-900 bg-green-50 border border-green-200 rounded px-3 py-2">
          Everything is working. Backups are running and have been proven restorable.
        </p>
      ) : (
        <p className="text-sm text-gray-800 bg-gray-100 border border-gray-300 rounded px-3 py-2">
          Work through the items marked ATTENTION or PROBLEM below. Each one names the command to run. The full
          instructions are in <code>docs/OPERATIONS.md</code> in the source repository.
        </p>
      )}

      <div className="space-y-2">
        {report.checks.map((check) => {
          const style = STYLE[check.finding.level];
          return (
            <div key={check.name} className={`border rounded p-3 ${style.row}`}>
              <div className="flex items-baseline gap-2">
                <span className={`text-white text-[10px] font-bold rounded px-1.5 py-0.5 ${style.badge}`}>{style.word}</span>
                <span className="font-medium">{check.name}</span>
              </div>
              <p className="text-sm mt-1">{check.finding.summary}</p>
              {check.finding.action ? (
                <p className="text-xs mt-1 text-gray-700">
                  <span className="font-medium">What to do: </span>
                  {check.finding.action}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="space-y-1">
        <h2 className="font-medium text-sm">Details</h2>
        <table className="bg-white border-collapse text-sm">
          <tbody>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Database response time</td>
              <td className="border border-gray-300 px-2 py-1">
                {report.details.databaseLatencyMs === null ? 'unreachable' : `${report.details.databaseLatencyMs} ms`}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Last successful backup</td>
              <td className="border border-gray-300 px-2 py-1">{report.details.lastBackup ?? 'never'}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Last proven restore</td>
              <td className="border border-gray-300 px-2 py-1">{report.details.lastVerifiedRestore ?? 'never'}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Last backup size</td>
              <td className="border border-gray-300 px-2 py-1">
                {report.details.lastBackupSizeBytes === null ? '—' : formatBytes(report.details.lastBackupSizeBytes)}
              </td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Backups retained</td>
              <td className="border border-gray-300 px-2 py-1">{report.details.dumpCount ?? '—'}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Background jobs running</td>
              <td className="border border-gray-300 px-2 py-1">{report.details.runningJobs}</td>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1">Background jobs failed (24 h)</td>
              <td className="border border-gray-300 px-2 py-1">{report.details.failedJobs24h}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p className="text-xs text-gray-500">
        A monitoring system can poll <code>/api/health</code>, which returns HTTP 503 when something has failed and 200
        otherwise. It exposes no academic data.
      </p>
    </div>
  );
}
