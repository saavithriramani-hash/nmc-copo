import Link from 'next/link';
import type { ReviewRound } from '@/lib/dashboard';
import type { CourseReadiness } from '@/lib/dashboardReadiness';
import { markCompletion, nextStep } from '@/lib/dashboardReadiness';

/**
 * The dashboard's shared pieces. Server components: none of this is
 * interactive, and everything it shows is already on the page.
 */

/** How long something has been waiting, in the words a person would use. */
export function since(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return date.toISOString().slice(0, 10);
}

export function Panel({
  title,
  hint,
  tone = 'plain',
  children,
}: {
  title: string;
  hint?: string;
  tone?: 'plain' | 'attention' | 'quiet';
  children: React.ReactNode;
}) {
  const border =
    tone === 'attention' ? 'border-amber-400 bg-amber-50' : tone === 'quiet' ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white';
  return (
    <section className={`border rounded p-4 space-y-2 ${border}`}>
      <div>
        <h2 className="font-medium">{title}</h2>
        {hint ? <p className="text-xs text-gray-600">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600">{children}</p>;
}

/**
 * A course a HoD asked to be changed, with what they said.
 *
 * The comment is quoted rather than summarised: it is the one thing the
 * faculty member has to act on, and it is the reason this feature
 * exists.
 */
export function ReturnedCourse({ round }: { round: ReviewRound }) {
  return (
    <div className="border border-amber-300 bg-white rounded p-3 space-y-1">
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href={`/courses/${round.courseId}`} className="text-blue-700 hover:underline font-medium">
          {round.courseCode} — {round.courseTitle}
        </Link>
        <span className="text-xs text-gray-600">
          returned by {round.resolvedBy} {round.resolvedAt ? since(round.resolvedAt) : ''}
        </span>
      </div>
      <blockquote className="text-sm text-amber-900 border-l-2 border-amber-400 pl-3 whitespace-pre-wrap">
        {round.returnComment}
      </blockquote>
      <p className="text-xs text-gray-600">
        Make the changes, then submit again from the{' '}
        <Link href={`/courses/${round.courseId}/attainment`} className="text-blue-700 hover:underline">
          Attainment
        </Link>{' '}
        tab.
      </p>
    </div>
  );
}

/** A table of courses with the one thing each still needs. */
export function ReadinessTable({ courses, showDepartment = false }: { courses: CourseReadiness[]; showDepartment?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full bg-white border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1">Course</th>
            {showDepartment ? <th className="border border-gray-300 px-2 py-1">Department</th> : null}
            <th className="border border-gray-300 px-2 py-1">Programme · Batch</th>
            <th className="border border-gray-300 px-2 py-1 w-24">Status</th>
            <th className="border border-gray-300 px-2 py-1 w-28">Marks</th>
            <th className="border border-gray-300 px-2 py-1">Next step</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => {
            const step = nextStep(course);
            const pct = markCompletion(course);
            return (
              <tr key={course.id} className="hover:bg-blue-50">
                <td className="border border-gray-300 px-2 py-1">
                  <Link href={`/courses/${course.id}`} className="text-blue-700 hover:underline font-medium">
                    {course.code}
                  </Link>
                  <span className="text-gray-600"> {course.title}</span>
                  {course.isLaboratory ? <span className="text-xs text-gray-500"> · lab</span> : null}
                </td>
                {showDepartment ? <td className="border border-gray-300 px-2 py-1">{course.departmentName}</td> : null}
                <td className="border border-gray-300 px-2 py-1 text-xs">
                  {course.programmeName} · {course.batchName}
                </td>
                <td className="border border-gray-300 px-2 py-1">
                  {course.status}
                  {course.lockedVersion ? <span className="text-xs text-gray-500"> v{course.lockedVersion}</span> : null}
                </td>
                <td className="border border-gray-300 px-2 py-1">
                  {/* A dash, not 0%, when there is no grid yet: "0%
                      entered" reads as a failure to enter marks rather
                      than as an assessment nobody has built. */}
                  {pct === null ? <span className="text-gray-400">—</span> : `${pct}%`}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-xs">
                  {step ? <span className="text-amber-800">{step}</span> : <span className="text-green-800">Ready to submit</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The approval queue, oldest first. */
export function ApprovalQueue({ rounds }: { rounds: ReviewRound[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full bg-white border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1">Course</th>
            <th className="border border-gray-300 px-2 py-1">Submitted by</th>
            <th className="border border-gray-300 px-2 py-1 w-32">Waiting</th>
            <th className="border border-gray-300 px-2 py-1 w-28"></th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round.id} className="hover:bg-blue-50">
              <td className="border border-gray-300 px-2 py-1">
                <Link href={`/courses/${round.courseId}`} className="text-blue-700 hover:underline font-medium">
                  {round.courseCode}
                </Link>
                <span className="text-gray-600"> {round.courseTitle}</span>
              </td>
              <td className="border border-gray-300 px-2 py-1">{round.submittedBy}</td>
              <td className="border border-gray-300 px-2 py-1">{since(round.submittedAt)}</td>
              <td className="border border-gray-300 px-2 py-1">
                <Link href={`/courses/${round.courseId}/attainment`} className="text-blue-700 hover:underline">
                  Review →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
