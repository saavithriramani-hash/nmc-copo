import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DrillDown } from '@/components/DrillDown';
import { WorkflowPanel } from '@/components/WorkflowPanel';
import { guard } from '@/lib/authz';
import { getCourseAttainment } from '@/lib/compute';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { warningsFingerprint } from '@/lib/versionDiff';

/**
 * Course attainment (FR-14/FR-15/FR-16): computed on demand from the
 * marks — nothing stored — and shown with every figure expandable down to
 * the raw marks. A locked course shows its immutable snapshot instead.
 */
export default async function AttainmentPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { status: true, code: true } });
  const [canSubmit, canLock, canUnlock, canSeeMarks] = await Promise.all([
    guard.check(user.userId, { type: 'course.submit', courseId }).then((d) => d.allow),
    guard.check(user.userId, { type: 'course.lock', courseId }).then((d) => d.allow),
    guard.check(user.userId, { type: 'course.unlock', courseId }).then((d) => d.allow),
    guard.check(user.userId, { type: 'marks.read', courseId }).then((d) => d.allow),
  ]);

  let attainment;
  try {
    attainment = await getCourseAttainment(courseId);
  } catch (err) {
    return (
      <div className="space-y-2">
        <h2 className="font-medium">Attainment</h2>
        <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          The course cannot be computed yet: {err instanceof Error ? err.message : String(err)}
        </p>
        <p className="text-xs text-gray-600">
          Check the <Link href={`/courses/${courseId}/review`} className="text-blue-700 hover:underline">pre-calculation review</Link>.
        </p>
      </div>
    );
  }
  if (!attainment) notFound();

  const { result, refs } = attainment;
  const fingerprint = warningsFingerprint(result.warnings);
  const belowTarget = result.finalCo.filter((co) => co.belowTarget);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium">Attainment</h2>
        {attainment.source === 'snapshot' ? (
          <span className="text-xs bg-gray-800 text-white rounded px-2 py-0.5">
            locked snapshot v{attainment.version} · {attainment.lockedAt?.toLocaleString()} · {attainment.lockedBy}
          </span>
        ) : (
          <span className="text-xs text-gray-600">computed just now from the current marks</span>
        )}
        <a
          href={`/api/courses/${courseId}/report`}
          className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 ml-auto"
        >
          PDF report
        </a>
        <a href={`/api/courses/${courseId}/export`} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">
          Export to Excel
        </a>
        <Link href={`/courses/${courseId}/versions`} className="text-xs text-blue-700 hover:underline">
          Version history →
        </Link>
      </div>

      {/* Warnings — prominent, never buried (§5.1) */}
      {result.warnings.length > 0 ? (
        <section className="border-2 border-amber-400 rounded bg-amber-50">
          <h3 className="px-3 py-2 font-medium text-amber-900 border-b border-amber-300">
            This course computed with {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
          </h3>
          <ul className="px-3 py-2 space-y-1">
            {result.warnings.map((warning, i) => (
              <li key={i} className="text-sm">
                <span className={`inline-block rounded px-1.5 text-xs font-medium mr-2 ${warning.severity === 'warning' ? 'bg-amber-200 text-amber-900' : 'bg-gray-200 text-gray-800'}`}>
                  {warning.code}
                </span>
                {warning.message}
              </li>
            ))}
          </ul>
          <p className="px-3 pb-2 text-xs text-amber-900">
            Every warning has a defined result behind it — nothing was silently set to zero. Fix the cause, or
            acknowledge them below before locking.
          </p>
        </section>
      ) : null}

      <WorkflowPanel
        courseId={courseId}
        status={course.status}
        warnings={result.warnings}
        fingerprint={fingerprint}
        canSubmit={canSubmit}
        canLock={canLock}
        canUnlock={canUnlock}
      />

      {/* CO summary */}
      <section className="space-y-1">
        <h3 className="font-medium text-sm">Course outcome attainment (Step 9)</h3>
        <table className="bg-white border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1">CO</th>
              <th className="border border-gray-300 px-2 py-1">Direct</th>
              <th className="border border-gray-300 px-2 py-1">Indirect</th>
              <th className="border border-gray-300 px-2 py-1">Final</th>
              <th className="border border-gray-300 px-2 py-1">Target</th>
            </tr>
          </thead>
          <tbody>
            {result.finalCo.map((co) => (
              <tr key={co.coId} className={co.belowTarget ? 'bg-amber-50' : ''}>
                <td className="border border-gray-300 px-2 py-1 font-medium">{refs.coCodeById[co.coId] ?? co.coId}</td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{co.direct?.toFixed(3) ?? '—'}</td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                  {co.indirect?.toFixed(3) ?? (co.directOnly ? 'direct-only' : '—')}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-right tabular-nums font-medium">{co.final?.toFixed(3) ?? '—'}</td>
                <td className="border border-gray-300 px-2 py-1 text-center">
                  {co.belowTarget === null ? '—' : co.belowTarget ? `below ${co.targetAttainment}` : 'met'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {belowTarget.length > 0 ? (
          <p className="text-xs text-amber-800">
            {belowTarget.length} CO{belowTarget.length === 1 ? '' : 's'} below the target of{' '}
            {result.finalCo[0]?.targetAttainment} — a gap analysis is expected for each (§4.5).
          </p>
        ) : null}
      </section>

      {/* PO/PSO + the drill-down */}
      <section className="space-y-2">
        <h3 className="font-medium text-sm">Programme outcome attainment (Step 10)</h3>
        <p className="text-xs text-gray-600">
          Expand any figure to follow its arithmetic back through every step to the individual item and the students who
          cleared its threshold.
        </p>
        {canSeeMarks ? (
          <DrillDown result={result} input={attainment.input} refs={refs} />
        ) : (
          <>
            <table className="bg-white border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-1">PO/PSO</th>
                  <th className="border border-gray-300 px-2 py-1">Weightage</th>
                  <th className="border border-gray-300 px-2 py-1">Official</th>
                  <th className="border border-gray-300 px-2 py-1">Secondary</th>
                </tr>
              </thead>
              <tbody>
                {result.po.map((po) => (
                  <tr key={po.poId}>
                    <td className="border border-gray-300 px-2 py-1 font-medium">{refs.poCodeById[po.poId] ?? po.poId}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{po.weightage?.toFixed(3) ?? '—'}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right tabular-nums font-medium">{po.official?.toFixed(3) ?? '—'}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right tabular-nums text-gray-600">{po.secondary?.toFixed(3) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500">
              The full drill-down reaches individual student marks, so it is shown only to the course faculty and their
              department chain (NFR-10).
            </p>
          </>
        )}
      </section>
    </div>
  );
}
