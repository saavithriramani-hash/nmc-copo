import Link from 'next/link';
import { createAssessmentAction, deleteAssessmentAction } from '@/actions/assessment';
import { adoptTemplateAction, saveTemplateFromCourseAction } from '@/actions/templates';
import { cloneCourseSetupAction } from '@/actions/clone';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { formatThresholdPercent } from '@/lib/courseThreshold';
import { resolveCourseParameters } from '@/lib/params';
import { requireSession } from '@/lib/session';

export default async function AssessmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const user = await requireSession();
  const { courseId } = await params;
  const { error, notice } = await searchParams;

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: {
      batch: { select: { programme: { select: { departmentId: true } } } },
      assessments: {
        orderBy: { displayOrder: 'asc' },
        include: { _count: { select: { items: true, sections: true, markValues: true } } },
      },
      _count: { select: { cos: true } },
    },
  });
  const departmentId = course.batch.programme.departmentId;

  const [canWrite, canManageTemplates] = await Promise.all([
    guard.check(user.userId, { type: 'course.write', courseId }).then((d) => d.allow),
    guard.check(user.userId, { type: 'templates.manage', departmentId }).then((d) => d.allow),
  ]);

  const { parameters } = await resolveCourseParameters(courseId);
  const weightGroups = Object.keys(parameters.weightGroups);

  const templates =
    canWrite && course.assessments.length === 0
      ? await prisma.assessmentTemplate.findMany({ where: { departmentId }, orderBy: { name: 'asc' } })
      : [];

  // Clone sources: courses the user can read (own, department, programme).
  const cloneSources =
    canWrite && course.assessments.length === 0 && course._count.cos === 0
      ? await prisma.course.findMany({
          where: {
            id: { not: courseId },
            OR: [
              { instructors: { some: { userId: user.userId } } },
              ...(user.hodDepartmentIds.length > 0
                ? [{ batch: { programme: { departmentId: { in: user.hodDepartmentIds } } } }]
                : []),
            ],
            cos: { some: {} },
          },
          include: { batch: { include: { programme: true } } },
          orderBy: { code: 'asc' },
        })
      : [];

  return (
    <div className="space-y-6">
      {error ? <p className="text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p> : null}
      {notice ? <p className="text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">{notice}</p> : null}

      {/* ── the fast path: adopt a department template ── */}
      {canWrite && course.assessments.length === 0 ? (
        <section className="bg-blue-50 border border-blue-200 rounded p-4 space-y-3">
          <h2 className="font-medium">Start from a department template</h2>
          {templates.length > 0 ? (
            <form action={adoptTemplateAction.bind(null, courseId)} className="flex items-center gap-2">
              <select name="templateId" required className="border border-gray-300 rounded px-2 py-1.5 bg-white min-w-64">
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">
                Adopt template
              </button>
              <span className="text-xs text-gray-600">Creates the whole structure at once — adjust it afterwards.</span>
            </form>
          ) : (
            <p className="text-xs text-gray-600">
              No templates in this department yet{canManageTemplates ? ' — build one course, then “Save as department template” below.' : '.'}
            </p>
          )}
          {cloneSources.length > 0 ? (
            <form action={cloneCourseSetupAction.bind(null, courseId)} className="flex items-center gap-2 border-t border-blue-200 pt-3">
              <span className="text-xs font-medium">Or clone a full setup (COs, matrix, assessments):</span>
              <select name="sourceCourseId" required className="border border-gray-300 rounded px-2 py-1.5 bg-white min-w-64">
                {cloneSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.code} — {source.title} ({source.batch.programme.name} {source.batch.name})
                  </option>
                ))}
              </select>
              <button type="submit" className="border border-gray-300 bg-white rounded px-3 py-1.5 hover:bg-gray-100">
                Clone setup
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-medium">Assessments</h2>
        {course.assessments.length === 0 ? (
          <p className="text-gray-600">None yet.</p>
        ) : (
          <table className="w-full bg-white border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="border border-gray-300 px-2 py-1">Name</th>
                <th className="border border-gray-300 px-2 py-1">Shape</th>
                <th className="border border-gray-300 px-2 py-1">Scoring</th>
                <th className="border border-gray-300 px-2 py-1">Weight group</th>
                <th className="border border-gray-300 px-2 py-1">Sections</th>
                <th className="border border-gray-300 px-2 py-1">Items</th>
                <th className="border border-gray-300 px-2 py-1 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {course.assessments.map((assessment) => (
                <tr key={assessment.id} className="hover:bg-blue-50">
                  <td className="border border-gray-300 px-2 py-1">
                    <Link href={`/courses/${courseId}/assessments/${assessment.id}`} className="text-blue-700 hover:underline font-medium">
                      {assessment.name}
                    </Link>
                  </td>
                  <td className="border border-gray-300 px-2 py-1">{assessment.shape}</td>
                  <td className="border border-gray-300 px-2 py-1">{assessment.scoringRule}</td>
                  <td className="border border-gray-300 px-2 py-1">{assessment.weightGroup}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{assessment.shape === 'SECTIONED' ? assessment._count.sections : '—'}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{assessment._count.items}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    {canWrite && assessment._count.markValues === 0 ? (
                      <form action={deleteAssessmentAction.bind(null, courseId, assessment.id)}>
                        <button type="submit" className="text-red-700 hover:underline">delete</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {canWrite ? (
        <section className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <h3 className="font-medium">Add an assessment</h3>
          <form action={createAssessmentAction.bind(null, courseId)} className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Name</span>
              <input name="name" required placeholder="Internal Test I" className="border border-gray-300 rounded px-2 py-1.5 w-48" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Shape</span>
              <select name="shape" required className="border border-gray-300 rounded px-2 py-1.5">
                <option value="SECTIONED">Sectioned (sections → questions)</option>
                <option value="ITEM_LIST">Item list (flat items)</option>
                <option value="SINGLE_SCORE">Single score</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Scoring rule</span>
              <select name="scoringRule" className="border border-gray-300 rounded px-2 py-1.5">
                {/* The threshold is a resolved parameter, not a constant:
                    the HoD may override it per course (§4.1). */}
                <option value="RUBRIC">Rubric ({formatThresholdPercent(parameters.thresholdFraction)}% threshold → bands)</option>
                <option value="COHORT_BAND">Cohort band (end-semester)</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Weight group</span>
              <select name="weightGroup" required className="border border-gray-300 rounded px-2 py-1.5">
                {weightGroups.map((group) => (
                  <option key={group} value={group}>
                    {group} ({parameters.weightGroups[group]})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Max mark (single score)</span>
              <input name="maxMark" type="number" step="0.5" min={0} placeholder="75" className="border border-gray-300 rounded px-2 py-1.5 w-28" />
            </label>
            <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Add</button>
          </form>
          <p className="text-xs text-gray-500">
            Cohort-band scoring applies to a single total score (the end-semester paper). Everything else uses the rubric.
          </p>
        </section>
      ) : null}

      {canManageTemplates && course.assessments.length > 0 ? (
        <section className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <h3 className="font-medium">Save as department template</h3>
          <p className="text-xs text-gray-600">
            Captures this course&apos;s assessment structure (CO tags become CO-position slots) so every other course adopts
            it in one action.
          </p>
          <form action={saveTemplateFromCourseAction.bind(null, courseId)} className="flex gap-2">
            <input name="name" required placeholder="e.g. Standard UG theory paper" className="flex-1 border border-gray-300 rounded px-2 py-1.5" />
            <button type="submit" className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100">Save template</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
