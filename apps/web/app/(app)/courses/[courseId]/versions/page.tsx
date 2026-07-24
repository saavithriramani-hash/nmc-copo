import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CourseInput, CourseResult } from '@copo/engine';
import { guard } from '@/lib/authz';
import type { Refs } from '@/lib/compute';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';
import { countMarkCells, diffSnapshots, type SnapshotForDiff } from '@/lib/versionDiff';

const fmt = (value: number | null): string => (value === null ? '—' : value.toFixed(3));

/**
 * Version history (FR-16). Every lock writes a new immutable snapshot;
 * nothing is ever overwritten (a database trigger rejects UPDATE and
 * DELETE on these rows). Each version is shown with what changed from the
 * one before it.
 */
export default async function VersionsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;
  if (!(await guard.check(user.userId, { type: 'course.read', courseId })).allow) notFound();

  const snapshots = await prisma.attainmentSnapshot.findMany({
    where: { courseId },
    orderBy: { version: 'asc' },
    include: { createdBy: { select: { fullName: true } } },
  });

  const parsed: (SnapshotForDiff & {
    version: number;
    createdAt: Date;
    createdBy: string;
    engineVersion: string;
    acknowledgedWarnings: number;
  })[] = snapshots.map((snapshot) => {
    const stored = snapshot.result as unknown as { result: CourseResult; refs: Refs; acknowledgedWarnings?: number };
    return {
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy.fullName,
      engineVersion: snapshot.engineVersion,
      acknowledgedWarnings: stored.acknowledgedWarnings ?? stored.result.warnings.length,
      input: snapshot.input as unknown as CourseInput,
      result: stored.result,
      coCodeById: stored.refs.coCodeById,
      poCodeById: stored.refs.poCodeById,
    };
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-baseline gap-3">
        <h2 className="font-medium">Version history</h2>
        <Link href={`/courses/${courseId}/attainment`} className="text-xs text-blue-700 hover:underline">
          ← Attainment
        </Link>
      </div>

      {parsed.length === 0 ? (
        <p className="text-gray-600">
          No versions yet. A version is written when the HoD approves and locks the course; unlocking and re-locking
          writes the next one beside it — nothing is overwritten.
        </p>
      ) : (
        <div className="space-y-3">
          {[...parsed].reverse().map((snapshot, reverseIndex) => {
            const index = parsed.length - 1 - reverseIndex;
            const previous = index > 0 ? parsed[index - 1] : null;
            const diff = previous ? diffSnapshots(previous, snapshot) : null;
            return (
              <section key={snapshot.version} className="border border-gray-300 rounded bg-white">
                <header className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex flex-wrap items-baseline gap-3">
                  <span className="font-medium">Version {snapshot.version}</span>
                  <span className="text-xs text-gray-600">
                    {snapshot.createdAt.toLocaleString()} · locked by {snapshot.createdBy} · engine{' '}
                    {snapshot.engineVersion}
                  </span>
                  {snapshot.acknowledgedWarnings > 0 ? (
                    <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 rounded px-2 py-0.5">
                      {snapshot.acknowledgedWarnings} warning(s) acknowledged at lock
                    </span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-900 border border-green-300 rounded px-2 py-0.5">no warnings</span>
                  )}
                  <span className="text-xs text-gray-500 ml-auto">
                    {countMarkCells(snapshot.input)} marks · {snapshot.input.assessments.length} assessments
                  </span>
                </header>

                <div className="px-3 py-2 space-y-2">
                  {/* The figures as approved */}
                  <details>
                    <summary className="cursor-pointer text-sm hover:underline">Figures as approved</summary>
                    <div className="mt-2 flex flex-wrap gap-6">
                      <table className="border-collapse text-sm">
                        <tbody>
                          {snapshot.result.finalCo.map((co) => (
                            <tr key={co.coId}>
                              <td className="border border-gray-300 px-2 py-0.5">{snapshot.coCodeById[co.coId] ?? co.coId}</td>
                              <td className="border border-gray-300 px-2 py-0.5 text-right tabular-nums">{fmt(co.final)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <table className="border-collapse text-sm">
                        <tbody>
                          {snapshot.result.po.map((po) => (
                            <tr key={po.poId}>
                              <td className="border border-gray-300 px-2 py-0.5">{snapshot.poCodeById[po.poId] ?? po.poId}</td>
                              <td className="border border-gray-300 px-2 py-0.5 text-right tabular-nums">{fmt(po.official)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>

                  {/* What changed from the previous version */}
                  {diff === null ? (
                    <p className="text-xs text-gray-600">First version.</p>
                  ) : diff.identical ? (
                    <p className="text-xs text-gray-600">No figures, parameters or inputs changed from version {previous!.version}.</p>
                  ) : (
                    <div className="text-sm space-y-1">
                      <p className="text-xs font-medium text-gray-700">Changed from version {previous!.version}:</p>
                      {diff.markCellChange ? (
                        <p className="text-xs">
                          Marks entered: {diff.markCellChange.from} → <b>{diff.markCellChange.to}</b>
                        </p>
                      ) : null}
                      {diff.assessmentCountChange ? (
                        <p className="text-xs">
                          Assessments: {diff.assessmentCountChange.from} → <b>{diff.assessmentCountChange.to}</b>
                        </p>
                      ) : null}
                      {diff.warningCountChange ? (
                        <p className="text-xs">
                          Warnings: {diff.warningCountChange.from} → <b>{diff.warningCountChange.to}</b>
                        </p>
                      ) : null}
                      {diff.parameterChanges.length > 0 ? (
                        <div className="text-xs">
                          Parameters:
                          <ul className="list-disc ml-5">
                            {diff.parameterChanges.map((change) => (
                              <li key={change.field}>
                                {change.field}: <code>{JSON.stringify(change.from)}</code> →{' '}
                                <code className="font-medium">{JSON.stringify(change.to)}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {diff.finalCoChanges.length > 0 ? (
                        <ChangeTable title="CO final attainment" changes={diff.finalCoChanges} />
                      ) : null}
                      {diff.poOfficialChanges.length > 0 ? (
                        <ChangeTable title="PO/PSO official attainment" changes={diff.poOfficialChanges} />
                      ) : null}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChangeTable({ title, changes }: { title: string; changes: { code: string; from: number | null; to: number | null }[] }) {
  return (
    <div>
      <p className="text-xs text-gray-700">{title}:</p>
      <table className="border-collapse text-xs">
        <tbody>
          {changes.map((change) => (
            <tr key={change.code}>
              <td className="border border-gray-300 px-2 py-0.5">{change.code}</td>
              <td className="border border-gray-300 px-2 py-0.5 text-right tabular-nums text-gray-500">{fmt(change.from)}</td>
              <td className="border border-gray-300 px-2 py-0.5">→</td>
              <td className="border border-gray-300 px-2 py-0.5 text-right tabular-nums font-medium">{fmt(change.to)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
