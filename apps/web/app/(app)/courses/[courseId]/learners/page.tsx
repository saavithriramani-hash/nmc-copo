import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LearnerRatingGrid } from '@/components/LearnerRatingGrid';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { courseRatingSheet } from '@/lib/learnerCategories';
import { requireSession } from '@/lib/session';

/**
 * Slow and advanced learners — the rating sheet for one subject (CR-8).
 *
 * The teacher's four judgements, beside the one figure derived from the
 * marks. This page is per-subject because that is who can judge; the
 * classification itself is a SEMESTER figure and lives on the programme,
 * since a student is slow or advanced across their subjects, not in one.
 *
 * Nothing here touches CO or PO attainment — see the header of
 * packages/engine/src/learnerCategories.ts.
 */
export default async function CourseLearnersPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;
  // Gated on `learners.rate`, NOT on `marks.read`.
  //
  // The obvious reading — "it names students, so use the marks bar" —
  // is wrong, and quietly so. CR-3 gave the examinations office
  // `marks.read` for one purpose: they enter the end-semester paper and
  // cannot do it blind. That grant is bounded at the point of use, so a
  // theory course's internal tests never appear to them. Nothing here is
  // a mark. These are a teacher's judgements of a student's attitude,
  // interaction and interest, and the COE has no business reading them
  // for every course in the college. `learners.rate` is exactly the
  // department chain — the course's own faculty and their HoD — which is
  // the audience this sheet has always been described as having.
  //
  // Read and write are one check because the audience is identical: in
  // this role model there is nobody who may read a colleague's
  // judgements without also being able to correct them.
  //
  // Checked, never `require`d: a denial from `require` throws and reaches
  // the reader as "Application error", which reads as a broken system
  // rather than a page that is not theirs. And not `notFound` either —
  // the course layout admits anyone with course.read, so the Dean, the
  // IQAC and the COE all see this tab and can click it. A 404 on a tab
  // the application itself offered is a dead end; the restriction is
  // explained instead, exactly as the learning-outcome page explains the
  // per-student table it withholds from the same readers.
  const canEdit = (await guard.check(user.userId, { type: 'learners.rate', courseId })).allow;
  const canSee = canEdit;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { semester: true, batchId: true, batch: { select: { programmeId: true } } },
  });
  if (!course) notFound();

  if (!canSee) {
    return (
      <div className="space-y-4">
        <h2 className="font-medium">Slow and advanced learners — this subject</h2>
        <p className="text-sm text-gray-700 max-w-3xl">
          This sheet is a teacher&apos;s judgement of each student by name, so it is restricted to the course faculty
          and their department chain (NFR-10).
        </p>
        <p className="text-sm text-gray-700 max-w-3xl">
          The classification these ratings feed is a semester figure, and its counts and distribution — which name
          nobody — are open to you there.
        </p>
        <Link
          href={`/programmes/${course.batch.programmeId}/learners?batch=${course.batchId}&semester=${course.semester}`}
          className="text-blue-700 hover:underline text-sm"
        >
          Semester classification →
        </Link>
      </div>
    );
  }

  const sheet = await courseRatingSheet(courseId);
  if (!sheet) notFound();

  const derived = sheet.criteria.find((c) => c.derived);
  const rated = Object.values(sheet.scores).reduce(
    (n, row) => n + Object.values(row).filter((v) => v !== null).length,
    0,
  );
  const editableCount = sheet.criteria.filter((c) => !c.derived).length;
  const cells = sheet.students.length * editableCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium">Slow and advanced learners — this subject</h2>
        {/*
          The batch as well as the semester: without it the classification
          page falls back to whichever batch it finds first, and a
          department running three cohorts at once would land on the wrong
          one — showing a semester this course's students are not in.
        */}
        <Link
          href={`/programmes/${sheet.course.programmeId}/learners?batch=${sheet.course.batchId}&semester=${sheet.course.semester}`}
          className="ml-auto text-blue-700 hover:underline text-sm"
        >
          Semester classification →
        </Link>
      </div>

      {sheet.criteria.length === 0 ? (
        <div className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <p className="font-medium">This programme has no rating criteria yet.</p>
          <p className="text-sm text-gray-700">
            The slow and advanced learner report (NAAC 2.2.1) rates each student on a few criteria per subject —
            interaction with teachers, seminars, interest in self-learning, and so on — averages them across the
            semester&apos;s subjects, and classifies from the total. What those criteria are is the department&apos;s
            choice, so they are set on the programme before anything can be entered here.
          </p>
          <p className="text-sm text-gray-700">
            Ratings change no attainment figure. They are read only by that report.
          </p>
          <Link href={`/programmes/${sheet.course.programmeId}/learners`} className="text-blue-700 hover:underline text-sm">
            Set the criteria →
          </Link>
        </div>
      ) : sheet.students.length === 0 ? (
        <div className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <p className="font-medium">No student is enrolled in this subject yet.</p>
          <Link href={`/courses/${courseId}/enrolment`} className="text-blue-700 hover:underline text-sm">
            Go to enrolment →
          </Link>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-600">
            {sheet.course.code} · semester {sheet.course.semester} · {sheet.students.length} student(s) ·{' '}
            {rated} of {cells} judgement(s) entered.
          </p>

          {derived ? (
            <p className="text-xs text-gray-600 max-w-3xl">
              <strong>{derived.label}</strong> is derived, not typed: it is each student&apos;s total marks as a share
              of the {sheet.marksTotal || '—'} marks this subject&apos;s papers allot, scaled to {derived.maxScore}. A
              student with no marks at all shows <span className="font-mono">—</span>, never 0 — they sat nothing, they
              did not score nothing.
            </p>
          ) : null}

          <LearnerRatingGrid
            courseId={courseId}
            students={sheet.students}
            criteria={sheet.criteria}
            initial={sheet.scores}
            weightage={sheet.weightage}
            canEdit={canEdit}
          />

          <p className="text-xs text-gray-500 max-w-3xl">
            These ratings feed no CO or PO attainment figure, and stay editable after the course is locked — the
            accreditation return that reads them is prepared on its own calendar.
          </p>
        </>
      )}
    </div>
  );
}
