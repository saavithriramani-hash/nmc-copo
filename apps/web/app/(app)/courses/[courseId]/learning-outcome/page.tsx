import { Fragment } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DownloadButton } from '@/components/DownloadButton';
import { guard } from '@/lib/authz';
import { knowledgeLevelReport, taggedAssessments } from '@/lib/knowledgeLevels';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * Learning outcome by knowledge level (CR-7) — the college's "Expected
 * (QP) and Actual" workbook, from marks already entered.
 *
 * Reads a paper twice: what it set out to examine, and what the students
 * did with it. Nothing here touches CO or PO attainment; see the header
 * of packages/engine/src/knowledgeLevels.ts for why that separation is
 * deliberate.
 */
export default async function LearningOutcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ a?: string }>;
}) {
  const user = await requireSession();
  const { courseId } = await params;
  const { a } = await searchParams;
  // check + notFound, never require: a denial from `require` throws and
  // reaches the reader as "Application error", which reads as a broken
  // system rather than a page that is not theirs. Every other page here
  // answers 404.
  if (!(await guard.check(user.userId, { type: 'course.read', courseId })).allow) notFound();

  // Per-student marks are the department chain's (NFR-10). The class
  // figures are not, so a reader without this stays on the page and sees
  // the blueprint and the cohort — the accreditation view — without the
  // register numbers.
  const canSeeStudents = (await guard.check(user.userId, { type: 'marks.read', courseId })).allow;

  const assessments = await taggedAssessments(courseId);
  const tagged = assessments.filter((entry) => entry.taggedItems > 0);
  const selectedId = a && tagged.some((entry) => entry.id === a) ? a : tagged[0]?.id;
  const report = selectedId ? await knowledgeLevelReport(courseId, selectedId) : null;
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { code: true } });

  const pct = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium">Learning outcome by knowledge level</h2>
        {report ? (
          <span className="ml-auto">
            <DownloadButton
              href={`/api/courses/${courseId}/learning-outcome?assessmentId=${report.assessment.id}`}
              label="Export to Excel"
              fallbackName={`Learning_Outcome_${course.code}.xlsx`}
            />
          </span>
        ) : null}
      </div>

      {tagged.length === 0 ? (
        <div className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <p className="font-medium">No question carries a knowledge level yet.</p>
          <p className="text-sm text-gray-700">
            This report reads a question paper twice: what it set out to examine, and what the students did with it.
            To produce it, open an assessment&apos;s structure and set the <strong>Knowledge level</strong> of each
            question — what it asks the student to do, which is not the same as the course outcome it assesses.
          </p>
          <p className="text-sm text-gray-700">
            Tagging changes no attainment figure. It is read only by this report.
          </p>
          <Link href={`/courses/${courseId}/assessments`} className="text-blue-700 hover:underline text-sm">
            Go to assessments →
          </Link>
        </div>
      ) : null}

      {tagged.length > 1 ? (
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <span className="text-gray-600">Question paper:</span>
          {tagged.map((entry) => (
            <Link
              key={entry.id}
              href={`/courses/${courseId}/learning-outcome?a=${entry.id}`}
              className={`border rounded px-2 py-1 ${
                entry.id === selectedId ? 'bg-blue-700 text-white border-blue-700' : 'border-gray-300 hover:bg-gray-100'
              }`}
            >
              {entry.name}
            </Link>
          ))}
        </div>
      ) : null}

      {report ? (
        <>
          <p className="text-xs text-gray-600">
            {report.assessment.name} · {report.assessment.taggedItems} of {report.assessment.totalItems} question(s)
            tagged · {report.result.paperTotal} marks measured.
            {report.assessment.taggedItems < report.assessment.totalItems ? (
              <span className="text-amber-800">
                {' '}
                Untagged questions are excluded from every figure below, including the paper total.
              </span>
            ) : null}
          </p>

          {/*
            Notes, not failures. Every one of these has a defined result
            behind it — an absent student, an untagged question, a level
            the paper does not examine — and none is a silent zero (§5.1).
          */}
          {report.result.warnings.length > 0 ? (
            <section className="border border-amber-300 rounded bg-amber-50">
              <ul className="px-3 py-2 space-y-1">
                {report.result.warnings.map((warning, i) => (
                  <li key={i} className="text-sm">
                    <span
                      className={`inline-block rounded px-1.5 text-xs font-medium mr-2 ${
                        warning.severity === 'warning' ? 'bg-amber-200 text-amber-900' : 'bg-gray-200 text-gray-800'
                      }`}
                    >
                      {warning.code}
                    </span>
                    {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ── the blueprint ── */}
          <section className="space-y-1">
            <h3 className="font-medium text-sm">Expected learning outcome — the question paper</h3>
            <p className="text-xs text-gray-600">
              What share of the paper asks the student to do each thing. Computed from the paper alone; it does not
              depend on a single mark, and is worth reading before the examination is held.
            </p>
            <table className="bg-white border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-1">Knowledge level</th>
                  <th className="border border-gray-300 px-2 py-1 text-right w-24">Questions</th>
                  <th className="border border-gray-300 px-2 py-1 text-right w-28">Marks</th>
                  <th className="border border-gray-300 px-2 py-1 text-right w-32">Expected %</th>
                </tr>
              </thead>
              <tbody>
                {report.result.blueprint.map((row) => (
                  <tr key={row.level} className={row.marksAllotted === 0 ? 'text-gray-400' : ''}>
                    <td className="border border-gray-300 px-2 py-1">{row.level}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{row.questionCount}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{row.marksAllotted}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{pct(row.expectedPercent)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="border border-gray-300 px-2 py-1">Total</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">{report.assessment.taggedItems}</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">{report.result.paperTotal}</td>
                  <td className="border border-gray-300 px-2 py-1 text-right">100.0%</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* ── the class ── */}
          <section className="space-y-1">
            <h3 className="font-medium text-sm">Attained — the class</h3>
            <p className="text-xs text-gray-600">
              Marks earned as a share of the marks the paper allotted to each level. A question left blank stays in
              the denominator, as the college&apos;s method requires. Students who attempted nothing are excluded.
            </p>
            <table className="bg-white border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-1">Knowledge level</th>
                  <th className="border border-gray-300 px-2 py-1 text-right w-32">Marks earned</th>
                  <th className="border border-gray-300 px-2 py-1 text-right w-28">Attained %</th>
                  <th className="border border-gray-300 px-2 py-1 text-center w-24">Level</th>
                  <th className="border border-gray-300 px-2 py-1 text-center w-48">Students at level 0 / 1 / 2 / 3</th>
                </tr>
              </thead>
              <tbody>
                {report.result.cohort.map((row) => (
                  <tr key={row.level} className={row.marksAllotted === 0 ? 'text-gray-400' : ''}>
                    <td className="border border-gray-300 px-2 py-1">{row.level}</td>
                    <td className="border border-gray-300 px-2 py-1 text-right">
                      {row.marksAllotted === 0 ? '—' : `${row.marksAwarded} of ${row.marksAllotted}`}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-right">{pct(row.attainedPercent)}</td>
                    <td className="border border-gray-300 px-2 py-1 text-center font-medium">
                      {row.attainmentLevel ?? '—'}
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center text-xs">
                      {row.marksAllotted === 0
                        ? '—'
                        : `${row.distribution[0]} / ${row.distribution[1]} / ${row.distribution[2]} / ${row.distribution[3]}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-500">
              Levels follow the same band table the course is graded against (§4.2): ≥80% → 3, ≥60% → 2, ≥40% → 1,
              below 40% → 0.
            </p>
          </section>

          {/* ── per student ── */}
          {canSeeStudents ? (
            <section className="space-y-1">
              <h3 className="font-medium text-sm">Attained — each student</h3>
              <div className="overflow-x-auto">
                <table className="bg-white border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      <th className="border border-gray-300 px-2 py-1">Register no.</th>
                      <th className="border border-gray-300 px-2 py-1">Name</th>
                      {report.result.blueprint.map((row) => (
                        <th key={row.level} className="border border-gray-300 px-2 py-1 text-center" colSpan={2}>
                          {row.level}
                        </th>
                      ))}
                      <th className="border border-gray-300 px-2 py-1 text-right w-24">Overall</th>
                    </tr>
                    <tr className="bg-gray-50 text-left text-xs">
                      <th className="border border-gray-300 px-2 py-1"></th>
                      <th className="border border-gray-300 px-2 py-1"></th>
                      {report.result.blueprint.map((row) => (
                        <Fragment key={row.level}>
                          <th className="border border-gray-300 px-2 py-1 text-right">%</th>
                          <th className="border border-gray-300 px-2 py-1 text-center">Level</th>
                        </Fragment>
                      ))}
                      <th className="border border-gray-300 px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.result.students.map((student) => {
                      const who = report.studentById[student.studentId];
                      return (
                        <tr key={student.studentId} className={student.absent ? 'text-gray-400 bg-gray-50' : ''}>
                          <td className="border border-gray-300 px-2 py-1">{who?.registerNumber ?? '—'}</td>
                          <td className="border border-gray-300 px-2 py-1">
                            {who?.fullName ?? '—'}
                            {student.absent ? <span className="text-xs"> · attempted nothing</span> : null}
                          </td>
                          {student.perLevel.map((row) => (
                            <Fragment key={row.level}>
                              <td className="border border-gray-300 px-2 py-1 text-right">
                                {student.absent ? '—' : pct(row.attainedPercent)}
                              </td>
                              <td className="border border-gray-300 px-2 py-1 text-center">
                                {student.absent ? '—' : (row.attainmentLevel ?? '—')}
                              </td>
                            </Fragment>
                          ))}
                          <td className="border border-gray-300 px-2 py-1 text-right font-medium">
                            {pct(student.overallPercent)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="text-xs text-gray-600">
              Per-student figures are restricted to the course faculty and their department chain (NFR-10).
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
