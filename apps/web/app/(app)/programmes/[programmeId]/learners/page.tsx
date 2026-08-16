import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DownloadButton } from '@/components/DownloadButton';
import { LearnerBandsEditor, LearnerCriteriaEditor } from '@/components/LearnerSetup';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { learnerCategoryReport, learnerCriteria, learnerReportOptions } from '@/lib/learnerCategories';
import { requireSession } from '@/lib/session';

/**
 * Slow and advanced learners for one batch and semester (CR-8) — NAAC
 * 2.2.1.
 *
 * WHO SEES WHAT. The counts and the distribution name nobody, and follow
 * `programme.read` — the Dean, the IQAC and the Principal keep them. The
 * ROLL, which labels identifiable students by learning ability, follows
 * `learners.read` and stops at the department chain, on the same
 * reasoning as NFR-10 for marks. The names are never assembled on this
 * page for a reader without it, not merely hidden by CSS.
 */
export default async function ProgrammeLearnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ programmeId: string }>;
  searchParams: Promise<{ batch?: string; semester?: string }>;
}) {
  const user = await requireSession();
  const { programmeId } = await params;
  const { batch: batchParam, semester: semesterParam } = await searchParams;
  // check + notFound, never require: a denial from `require` throws and
  // surfaces as "Application error: a server-side exception has
  // occurred", which tells the reader nothing and looks like a fault in
  // the system rather than a page that is not theirs. Every other page
  // here answers 404, and so must this one — whether a programme exists
  // is itself something the caller may not be entitled to learn.
  if (!(await guard.check(user.userId, { type: 'programme.read', programmeId })).allow) notFound();

  const [canSeeNames, canConfigure] = await Promise.all([
    guard.check(user.userId, { type: 'learners.read', programmeId }).then((d) => d.allow),
    guard.check(user.userId, { type: 'learners.configure', programmeId }).then((d) => d.allow),
  ]);

  const programme = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: { id: true, name: true, department: { select: { name: true } } },
  });
  if (!programme) notFound();

  const [criteria, options] = await Promise.all([learnerCriteria(programmeId), learnerReportOptions(programmeId)]);

  const chosenBatch = options.find((o) => o.batch.id === batchParam) ?? options.find((o) => o.semesters.length > 0) ?? options[0];
  const semesters = chosenBatch?.semesters ?? [];
  const chosenSemester = semesterParam && semesters.includes(Number(semesterParam)) ? Number(semesterParam) : semesters[0];

  const report =
    chosenBatch && chosenSemester !== undefined
      ? await learnerCategoryReport(programmeId, chosenBatch.batch.id, chosenSemester)
      : null;

  const ratingCounts = await prisma.learnerCriterion.findMany({
    where: { programmeId },
    select: { id: true, _count: { select: { ratings: true } } },
  });
  const ratingsById = new Map(ratingCounts.map((r) => [r.id, r._count.ratings]));

  const fmt = (value: number | null, digits = 1) => (value === null ? '—' : value.toFixed(digits));

  const unjudged = report?.result.students.filter((s) => s.category === null && s.totalScore !== null).length ?? 0;
  const nothingRecorded = report?.result.students.filter((s) => s.totalScore === null).length ?? 0;

  /**
   * How far each subject's rating sheet has been filled in, and the way
   * back to it.
   *
   * This page is where a Head of Department discovers that half the
   * cohort is awaiting a judgement; it has to say WHICH subject is
   * waiting, and let them go straight there. Counted over the criteria a
   * person judges — the derived weightage needs nobody to enter it, so
   * including it would report every subject as part-done before anyone
   * had touched it.
   */
  const judgedCriteria = report?.criteria.filter((c) => !c.derived) ?? [];
  const subjectProgress = (report?.courses ?? []).map((course) => {
    const scores = report?.courseScores[course.id] ?? {};
    const students = Object.keys(scores).length;
    let entered = 0;
    for (const row of Object.values(scores)) {
      for (const criterion of judgedCriteria) {
        const value = row[criterion.id];
        if (value !== null && value !== undefined) entered += 1;
      }
    }
    return { course, students, entered, expected: students * judgedCriteria.length };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <div>
          <h1 className="text-lg font-semibold">Slow and advanced learners</h1>
          <p className="text-xs text-gray-600">
            {programme.name} · {programme.department.name} · NAAC 2.2.1
          </p>
        </div>
        <Link href={`/programmes/${programmeId}`} className="ml-auto text-sm text-blue-700 hover:underline">
          ← Programme
        </Link>
      </div>

      {/* ── what is rated ── */}
      <section className="space-y-2">
        <h2 className="font-medium">What each subject rates</h2>
        {canConfigure ? (
          <LearnerCriteriaEditor
            // The editor holds its rows in local state so a half-typed
            // form is not thrown away on every keystroke's re-render.
            // That means it must be REMOUNTED when the server's list
            // genuinely changes — otherwise seeding the standard five
            // leaves an empty table behind, with the rows in the database.
            key={criteria.map((c) => c.id).join(',')}
            programmeId={programmeId}
            initial={criteria.map((c) => ({
              id: c.id,
              label: c.label,
              maxScore: c.maxScore,
              derived: c.derived,
              ratings: ratingsById.get(c.id) ?? 0,
            }))}
            anyRatings={[...ratingsById.values()].some((n) => n > 0)}
          />
        ) : criteria.length === 0 ? (
          <p className="text-sm text-gray-600">
            Not set up yet — the Head of the Department chooses what this programme rates.
          </p>
        ) : (
          <ul className="text-sm list-disc pl-5">
            {criteria.map((c) => (
              <li key={c.id}>
                {c.label} <span className="text-gray-500">/ {c.maxScore}</span>
                {c.derived ? <span className="text-gray-500"> · derived from the marks</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {criteria.length === 0 ? null : (
        <>
          {/* ── which cohort ── */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-medium">The classification</h2>
              {report && canSeeNames ? (
                <span className="ml-auto">
                  <DownloadButton
                    href={`/api/programmes/${programmeId}/learners?batchId=${report.batch.id}&semester=${report.semester}`}
                    label="Export to Excel"
                    fallbackName={`Slow_and_Advanced_Learners_${report.batch.name}_Sem${report.semester}.xlsx`}
                  />
                </span>
              ) : null}
            </div>

            {options.length === 0 ? (
              <p className="text-sm text-gray-600">This programme has no batches yet.</p>
            ) : (
              <div className="flex flex-wrap gap-4 items-center text-sm">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-gray-600">Batch:</span>
                  {options.map((option) => (
                    <Link
                      key={option.batch.id}
                      href={`/programmes/${programmeId}/learners?batch=${option.batch.id}`}
                      className={`border rounded px-2 py-1 ${
                        option.batch.id === chosenBatch?.batch.id
                          ? 'bg-blue-700 text-white border-blue-700'
                          : 'border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      {option.batch.name}
                    </Link>
                  ))}
                </div>
                {semesters.length > 0 ? (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-gray-600">Semester:</span>
                    {semesters.map((semester) => (
                      <Link
                        key={semester}
                        href={`/programmes/${programmeId}/learners?batch=${chosenBatch?.batch.id}&semester=${semester}`}
                        className={`border rounded px-2 py-1 ${
                          semester === chosenSemester
                            ? 'bg-blue-700 text-white border-blue-700'
                            : 'border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {semester}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {report === null ? (
            <p className="text-sm text-gray-600">
              {chosenBatch ? 'This batch has no courses in any semester yet.' : 'Nothing to report yet.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-600">
                {report.batch.name} · semester {report.semester} · {report.courses.length} subject(s)
              </p>

              {canConfigure ? (
                <LearnerBandsEditor programmeId={programmeId} initial={report.applied.bands} source={report.applied.source} />
              ) : (
                <p className="text-xs text-gray-600">
                  Categories:{' '}
                  {[...report.applied.bands]
                    .sort((a, b) => b.lowerPercent - a.lowerPercent)
                    .map((b) => `${b.category} ≥ ${b.lowerPercent}`)
                    .join(' · ')}{' '}
                  — {report.applied.source === 'programme' ? 'set for this programme' : report.applied.source === 'institution' ? 'inherited from the institution' : 'the built-in default'}.
                </p>
              )}

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

              {/* ── the counts: no names, so everyone who may read the programme sees them ── */}
              <section className="space-y-1">
                <h3 className="font-medium text-sm">How the cohort divides</h3>
                <table className="bg-white border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      <th className="border border-gray-300 px-2 py-1 w-40">Category</th>
                      <th className="border border-gray-300 px-2 py-1 text-right w-28">Students</th>
                      <th className="border border-gray-300 px-2 py-1 text-right w-28">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.result.counts.map((row) => (
                      <tr key={row.category}>
                        <td className="border border-gray-300 px-2 py-1">{row.category}</td>
                        <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{row.students}</td>
                        <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                          {row.percent === null ? '—' : `${row.percent.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                    {/*
                      Two different absences, kept apart because only one
                      of them is work waiting to be done: a student with a
                      mark-derived figure and no judgement needs a teacher
                      to open the sheet, while a student with nothing at
                      all may simply not have sat anything yet.
                    */}
                    {unjudged > 0 ? (
                      <tr className="text-gray-500">
                        <td className="border border-gray-300 px-2 py-1">Awaiting a teacher&apos;s judgement</td>
                        <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{unjudged}</td>
                        <td className="border border-gray-300 px-2 py-1 text-right">—</td>
                      </tr>
                    ) : null}
                    {nothingRecorded > 0 ? (
                      <tr className="text-gray-500">
                        <td className="border border-gray-300 px-2 py-1">Nothing recorded</td>
                        <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{nothingRecorded}</td>
                        <td className="border border-gray-300 px-2 py-1 text-right">—</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500">
                  Shares are of the students actually classified, so a half-filled sheet cannot report a cohort as
                  mostly slow learners.
                </p>
              </section>

              {/*
                ── the way back to the rating sheets ──

                The counts above are where an outstanding sheet is
                noticed; this is where it is dealt with. Ratings are
                entered per subject, by the person who taught it, so a
                page reporting that half the cohort awaits a judgement has
                to say which subject is waiting and lead there directly.
              */}
              {subjectProgress.length > 0 ? (
                <section className="space-y-1">
                  <h3 className="font-medium text-sm">Where the ratings stand</h3>
                  <table className="bg-white border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-100 text-left">
                        <th className="border border-gray-300 px-2 py-1 w-32">Subject</th>
                        <th className="border border-gray-300 px-2 py-1">Title</th>
                        <th className="border border-gray-300 px-2 py-1 text-right w-24">Students</th>
                        <th className="border border-gray-300 px-2 py-1 text-right w-36">Judgements</th>
                        {canSeeNames ? <th className="border border-gray-300 px-2 py-1 w-36"></th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {subjectProgress.map(({ course, students, entered, expected }) => {
                        const done = expected > 0 && entered === expected;
                        return (
                          <tr key={course.id} className={done ? '' : 'bg-amber-50'}>
                            <td className="border border-gray-300 px-2 py-1 font-mono">{course.code}</td>
                            <td className="border border-gray-300 px-2 py-1">{course.title}</td>
                            <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{students}</td>
                            <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                              {expected === 0 ? '—' : `${entered} of ${expected}`}
                              {done ? <span className="text-green-800"> ✓</span> : null}
                            </td>
                            {canSeeNames ? (
                              <td className="border border-gray-300 px-2 py-1">
                                <Link
                                  href={`/courses/${course.id}/learners`}
                                  className="text-blue-700 hover:underline"
                                >
                                  {entered === 0 ? 'Enter ratings' : done ? 'Review ratings' : 'Finish ratings'} →
                                </Link>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-500">
                    Counted over the criteria a teacher judges. The mark-derived one needs nobody to enter it, so it is
                    left out — otherwise every subject would read as part-done before anyone had opened it.
                  </p>
                </section>
              ) : null}

              {/* ── the roll: names, so department chain only ── */}
              {canSeeNames ? (
                <section className="space-y-1">
                  <h3 className="font-medium text-sm">Each student</h3>
                  <p className="text-xs text-gray-600">
                    Each criterion is averaged over the subjects in which it was rated — never over the subjects taken
                    — and the averages summed. A criterion nobody rated leaves the total obtainable as well, so the
                    score stays comparable.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="bg-white border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-100 text-left">
                          <th className="border border-gray-300 px-2 py-1">Register no.</th>
                          <th className="border border-gray-300 px-2 py-1">Name</th>
                          <th className="border border-gray-300 px-2 py-1 text-right w-20">Subjects</th>
                          {report.criteria.map((c) => (
                            <th key={c.id} className="border border-gray-300 px-2 py-1 text-right w-24">
                              <span className="font-normal text-xs">{c.label}</span>
                            </th>
                          ))}
                          <th className="border border-gray-300 px-2 py-1 text-right w-28">Final score</th>
                          <th className="border border-gray-300 px-2 py-1 w-28">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.result.students.map((student) => {
                          const who = report.studentById[student.studentId];
                          const unrated = student.category === null;
                          return (
                            <tr key={student.studentId} className={unrated ? 'text-gray-400 bg-gray-50' : ''}>
                              <td className="border border-gray-300 px-2 py-1 font-mono">{who?.registerNumber ?? '—'}</td>
                              <td className="border border-gray-300 px-2 py-1">{who?.fullName ?? '—'}</td>
                              <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">
                                {student.coursesTaken}
                              </td>
                              {student.perCriterion.map((row) => (
                                <td
                                  key={row.criterionId}
                                  className="border border-gray-300 px-2 py-1 text-right tabular-nums"
                                  title={row.mean === null ? 'not rated in any subject' : `averaged over ${row.ratedIn} subject(s)`}
                                >
                                  {fmt(row.mean)}
                                </td>
                              ))}
                              <td className="border border-gray-300 px-2 py-1 text-right tabular-nums font-medium">
                                {student.totalScore === null
                                  ? '—'
                                  : `${fmt(student.totalScore)} / ${student.obtainableScore}`}
                                {student.partiallyRated ? <span title="rated on some criteria only"> *</span> : null}
                              </td>
                              <td className="border border-gray-300 px-2 py-1">
                                {student.category ?? (
                                  <span className="text-xs">
                                    {student.totalScore === null
                                      ? 'nothing recorded'
                                      : 'awaiting a judgement'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-500">
                    * scored out of the criteria that were rated, not out of {report.result.fullObtainableScore}.
                  </p>
                </section>
              ) : (
                <p className="text-xs text-gray-600">
                  The roll naming individual students is restricted to the department chain. The counts above carry no
                  names and are the figure an accreditation return reports.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
