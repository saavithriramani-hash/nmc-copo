import Link from 'next/link';
import { ApprovalQueue, Empty, Panel, ReadinessTable, ReturnedCourse, since } from '@/components/DashboardParts';
import { EXTERNAL_WEIGHT_GROUP } from '@/lib/authz';
import { courseReadiness, institutionRollup, latestRoundPerCourse, pendingRounds } from '@/lib/dashboard';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/**
 * The landing page: what needs this person, in the order it needs them.
 *
 * ROLES COMPOSE RATHER THAN CHOOSE. One account here holds four roles at
 * once, so the page stacks the sections each role earns instead of
 * picking a "primary" one — a HoD who also teaches sees their approval
 * queue AND their own courses.
 *
 * Nothing here computes attainment. See lib/dashboard.ts: every figure
 * is a count or a status, because the engine runs over every mark in a
 * course and a dashboard cannot afford that thirty times over. Locked
 * courses show their stored version, which costs nothing.
 */
export default async function DashboardPage() {
  const user = await requireSession();

  const isCoe = user.roles.some((role) => role.kind === 'COE');
  const isHod = user.hodDepartmentIds.length > 0;
  const readsInstitution = user.roles.some((role) => ['DEAN', 'IQAC', 'PRINCIPAL'].includes(role.kind));
  const teaches = user.isFaculty;

  // ── what this person teaches ─────────────────────────────────────────
  const myCourses = teaches ? await courseReadiness({ instructors: { some: { userId: user.userId } } }) : [];
  const myRounds = await latestRoundPerCourse(myCourses.map((course) => course.id));
  // Returned AND back in DRAFT: once resubmitted the round is superseded,
  // so this empties itself without anyone marking it resolved.
  const returnedToMe = myCourses
    .filter((course) => course.status === 'DRAFT' && myRounds.get(course.id)?.resolution === 'RETURNED')
    .map((course) => myRounds.get(course.id)!);

  // ── what this person heads ───────────────────────────────────────────
  const deptCourses = isHod
    ? await courseReadiness({ batch: { programme: { departmentId: { in: user.hodDepartmentIds } } } })
    : [];
  const queue = await pendingRounds(deptCourses.map((course) => course.id));
  const deptRounds = await latestRoundPerCourse(deptCourses.map((course) => course.id));
  const awaitingResubmission = deptCourses
    .filter((course) => course.status === 'DRAFT' && deptRounds.get(course.id)?.resolution === 'RETURNED')
    .map((course) => ({ course, round: deptRounds.get(course.id)! }));
  const unstaffed = deptCourses.filter((course) => course.instructors.length === 0);

  // ── the examinations office ──────────────────────────────────────────
  const coeCourses = isCoe ? await courseReadiness({ isLaboratory: false }) : [];
  const externalOutstanding = isCoe
    ? await prisma.course.findMany({
        where: { isLaboratory: false, status: { not: 'LOCKED' } },
        select: {
          id: true,
          code: true,
          title: true,
          _count: { select: { enrolments: true } },
          assessments: {
            where: { weightGroup: EXTERNAL_WEIGHT_GROUP },
            select: { id: true, _count: { select: { markValues: true } } },
          },
        },
        orderBy: { code: 'asc' },
      })
    : [];
  const noExternalPaper = externalOutstanding.filter((course) => course.assessments.length === 0);
  const externalUnmarked = externalOutstanding.filter(
    (course) => course.assessments.length > 0 && course.assessments.every((a) => a._count.markValues === 0) && course._count.enrolments > 0,
  );

  const rollup = readsInstitution ? await institutionRollup() : [];

  // The administrator holds no academic data by design (§2), so their
  // panel is signposts, not figures — but they must not be told they
  // "hold no role", which is what the empty state would otherwise say.
  const nothingToShow = !teaches && !isHod && !isCoe && !readsInstitution && !user.isAdmin;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <Link href="/courses" className="text-sm text-blue-700 hover:underline">
          All courses →
        </Link>
      </div>

      {nothingToShow ? (
        <Empty>
          Your account holds no role yet, so there is nothing to show. The system administrator grants roles on the
          Accounts &amp; roles screen.
        </Empty>
      ) : null}

      {/* Top of the page on purpose: it is the only thing here that is
          blocked on the person reading it. */}
      {returnedToMe.length > 0 ? (
        <Panel
          title={`${returnedToMe.length} course${returnedToMe.length === 1 ? '' : 's'} sent back to you`}
          hint="Your Head of Department asked for changes before approving."
          tone="attention"
        >
          <div className="space-y-2">
            {returnedToMe.map((round) => (
              <ReturnedCourse key={round.id} round={round} />
            ))}
          </div>
        </Panel>
      ) : null}

      {isHod ? (
        <Panel
          title={queue.length > 0 ? `${queue.length} waiting for your approval` : 'Nothing waiting for approval'}
          hint="Submitted by your department, oldest first."
          tone={queue.length > 0 ? 'attention' : 'quiet'}
        >
          {queue.length > 0 ? <ApprovalQueue rounds={queue} /> : <Empty>Nothing has been submitted.</Empty>}
        </Panel>
      ) : null}

      {isHod && awaitingResubmission.length > 0 ? (
        <Panel title="Sent back, not yet resubmitted" hint="What you asked for, and who owes it.">
          <ul className="space-y-2 text-sm">
            {awaitingResubmission.map(({ course, round }) => (
              <li key={course.id} className="border border-gray-200 rounded p-2 space-y-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link href={`/courses/${course.id}`} className="text-blue-700 hover:underline font-medium">
                    {course.code}
                  </Link>
                  <span className="text-xs text-gray-600">
                    {course.instructors.join(', ') || 'nobody assigned'} · returned {round.resolvedAt ? since(round.resolvedAt) : ''}
                  </span>
                </div>
                <p className="text-xs text-gray-700 whitespace-pre-wrap">“{round.returnComment}”</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {teaches && myCourses.length > 0 ? (
        <Panel title="Your courses" hint="What each still needs before it can be submitted.">
          <ReadinessTable courses={myCourses} />
        </Panel>
      ) : null}

      {isHod ? (
        <Panel title="Department readiness" hint="Every course of your department.">
          {deptCourses.length > 0 ? <ReadinessTable courses={deptCourses} /> : <Empty>No courses yet.</Empty>}
        </Panel>
      ) : null}

      {isHod && unstaffed.length > 0 ? (
        <Panel
          title={`${unstaffed.length} course${unstaffed.length === 1 ? '' : 's'} with no faculty assigned`}
          hint="The examinations office creates courses; assigning who teaches them is yours (FR-4)."
          tone="attention"
        >
          <ul className="text-sm space-y-1">
            {unstaffed.map((course) => (
              <li key={course.id}>
                <Link href={`/courses/${course.id}`} className="text-blue-700 hover:underline">
                  {course.code} — {course.title}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {isCoe ? (
        <>
          <Panel
            title={`${noExternalPaper.length} course${noExternalPaper.length === 1 ? '' : 's'} with no end-semester paper set up`}
            hint="Theory courses only — a laboratory course's practical examination belongs to its department."
            tone={noExternalPaper.length > 0 ? 'attention' : 'quiet'}
          >
            {noExternalPaper.length > 0 ? (
              <ul className="text-sm space-y-1">
                {noExternalPaper.map((course) => (
                  <li key={course.id}>
                    <Link href={`/courses/${course.id}/assessments`} className="text-blue-700 hover:underline">
                      {course.code} — {course.title}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Every theory course has its external assessment.</Empty>
            )}
          </Panel>

          <Panel
            title={`${externalUnmarked.length} awaiting external marks`}
            hint="The paper exists and students are enrolled, but no marks are in yet."
            tone={externalUnmarked.length > 0 ? 'attention' : 'quiet'}
          >
            {externalUnmarked.length > 0 ? (
              <ul className="text-sm space-y-1">
                {externalUnmarked.map((course) => (
                  <li key={course.id}>
                    <Link href={`/courses/${course.id}/marks`} className="text-blue-700 hover:underline">
                      {course.code} — {course.title}
                    </Link>
                    <span className="text-xs text-gray-600"> · {course._count.enrolments} students</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nothing outstanding.</Empty>
            )}
          </Panel>

          <Panel title="The catalogue" hint="Every theory course in the college.">
            <ReadinessTable courses={coeCourses} showDepartment />
          </Panel>
        </>
      ) : null}

      {user.isAdmin ? (
        <Panel title="Administration" hint="Accounts, structures and backups. The administrator holds no academic data (§2)." tone="quiet">
          <ul className="text-sm space-y-1">
            <li>
              <Link href="/admin/users" className="text-blue-700 hover:underline">
                Accounts &amp; roles
              </Link>{' '}
              <span className="text-gray-600">— create accounts, grant and end roles</span>
            </li>
            <li>
              <Link href="/admin/departments" className="text-blue-700 hover:underline">
                Departments &amp; programmes
              </Link>{' '}
              <span className="text-gray-600">— the institution structure and its batches</span>
            </li>
            <li>
              <Link href="/admin/health" className="text-blue-700 hover:underline">
                System health
              </Link>{' '}
              <span className="text-gray-600">— backups and the state of the server</span>
            </li>
            <li>
              <Link href="/audit" className="text-blue-700 hover:underline">
                Audit log
              </Link>{' '}
              <span className="text-gray-600">— every edit, never pruned (FR-17)</span>
            </li>
          </ul>
        </Panel>
      ) : null}

      {readsInstitution ? (
        <Panel
          title="The college"
          hint="Courses by status, per department. Counts only — per-student marks stay with the course faculty and their department chain (NFR-10)."
        >
          <div className="overflow-x-auto">
            <table className="w-full bg-white border-collapse text-sm max-w-2xl">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-1">Department</th>
                  <th className="border border-gray-300 px-2 py-1 w-24">Draft</th>
                  <th className="border border-gray-300 px-2 py-1 w-28">Submitted</th>
                  <th className="border border-gray-300 px-2 py-1 w-24">Locked</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((row) => (
                  <tr key={row.departmentName}>
                    <td className="border border-gray-300 px-2 py-1">{row.departmentName}</td>
                    <td className="border border-gray-300 px-2 py-1">{row.draft}</td>
                    <td className="border border-gray-300 px-2 py-1">{row.submitted}</td>
                    <td className="border border-gray-300 px-2 py-1 text-green-800">{row.locked}</td>
                  </tr>
                ))}
                {rollup.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="border border-gray-300 px-2 py-2 text-gray-600">
                      No courses yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Attainment figures are not shown here: they are computed from every mark in a course, so they come from{' '}
            <Link href="/institution" className="text-blue-700 hover:underline">
              institution consolidation
            </Link>
            , which runs as a background job.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
