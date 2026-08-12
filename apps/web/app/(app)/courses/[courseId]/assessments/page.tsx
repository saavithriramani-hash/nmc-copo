import Link from 'next/link';
import { createAssessmentAction, deleteAssessmentAction } from '@/actions/assessment';
import { adoptTemplateAction, saveTemplateFromCourseAction } from '@/actions/templates';
import { cloneCourseSetupAction } from '@/actions/clone';
import { canWriteAssessment, guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { assessmentMaxima, formatMark } from '@/lib/assessmentMaxima';
import { formatThresholdPercent } from '@/lib/courseThreshold';
import { resolveCourseParameters } from '@/lib/params';
import { parsePattern } from '@/lib/setupPlans';
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
        include: {
          _count: { select: { items: true, sections: true, markValues: true } },
          // The maximum is derived from the items — there is no maxMark
          // column on Assessment. One course's items only (NFR-1): a few
          // hundred rows, the same bound the adapter accepts.
          items: { select: { sectionId: true, maxMark: true } },
          sections: { select: { id: true, optionalAnswerCount: true } },
        },
      },
      _count: { select: { cos: true } },
    },
  });
  const departmentId = course.batch.programme.departmentId;

  const [canWrite, canManageTemplates, canPublishTemplates, canWriteExternal] = await Promise.all([
    guard.check(user.userId, { type: 'course.write', courseId }).then((d) => d.allow),
    guard.check(user.userId, { type: 'templates.manage', departmentId }).then((d) => d.allow),
    // CR-3: publishing a pattern for the whole college is the COE's.
    guard.check(user.userId, { type: 'templates.institution.manage' }).then((d) => d.allow),
    guard.check(user.userId, { type: 'assessment.external.write', courseId }).then((d) => d.allow),
  ]);
  // Adoption creates assessments, so it needs whoever may create them —
  // the department for a pattern of internals, the COE for the external.
  const canAdopt = canWrite || canWriteExternal;

  const { parameters } = await resolveCourseParameters(courseId);
  const allWeightGroups = Object.keys(parameters.weightGroups);
  /**
   * CR-3: only the groups this person may actually create in.
   *
   * The end-semester paper of a theory course belongs to the Controller
   * of Examinations, so offering an HoD an "external" option and then
   * refusing the submission is a crash waiting to happen — and it was
   * one. On a LABORATORY course the department conducts the practical
   * examination, so the same option is theirs and does appear.
   */
  const writableGroups: string[] = [];
  for (const group of allWeightGroups) {
    if (await canWriteAssessment(user.userId, courseId, group)) writableGroups.push(group);
  }
  const hiddenGroups = allWeightGroups.filter((group) => !writableGroups.includes(group));

  const candidateTemplates =
    canAdopt && course.assessments.length === 0
      ? await prisma.assessmentTemplate.findMany({
          // This department's own patterns, plus the institution-wide
          // ones the COE published for everybody (CR-3).
          where: { OR: [{ departmentId }, { departmentId: null }] },
          orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
        })
      : [];

  /**
   * Only the patterns this person could actually apply.
   *
   * Adoption creates assessments, so it needs the permission creating
   * each one by hand would. Offering a pattern that the action will then
   * refuse is worse than not offering it — an HoD would pick the
   * college's external pattern on a theory course and watch nothing
   * happen. On a LABORATORY course the same pattern IS theirs to apply,
   * so this has to be asked per course rather than decided by role.
   */
  const templates = (
    await Promise.all(
      candidateTemplates.map(async (template) => {
        const groups = new Set(parsePattern(template.pattern).assessments.map((a) => a.weightGroup));
        for (const group of groups) {
          if (!(await canWriteAssessment(user.userId, courseId, group))) return null;
        }
        return template;
      }),
    )
  ).filter((template) => template !== null);

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

      {/* ── the fast path: adopt a template ── */}
      {canAdopt && course.assessments.length === 0 ? (
        <section className="bg-blue-50 border border-blue-200 rounded p-4 space-y-3">
          <h2 className="font-medium">Start from a template</h2>
          {templates.length > 0 ? (
            <form action={adoptTemplateAction.bind(null, courseId)} className="flex items-center gap-2">
              <select name="templateId" required className="border border-gray-300 rounded px-2 py-1.5 bg-white min-w-64">
                {/* An institution-wide pattern is marked, because adopting
                    one is a different act: it is the college's external
                    examination, not this department's own arrangement. */}
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                    {template.departmentId === null ? ' — all departments (external examination)' : ''}
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
              No templates available yet{canManageTemplates ? ' — build one course, then “Save as template” below.' : '.'}
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
                {/* PLURAL here, singular in the structure editor, and the
                    difference is real: this is a paper's total, which
                    every Indian question paper prints as "Maximum Marks",
                    whereas an Item's `maxMark` is what one question is
                    worth. Do not "correct" one to match the other. */}
                <th className="border border-gray-300 px-2 py-1 text-right">Maximum marks</th>
                {/* No heading needed — every cell below carries a button
                    that labels itself. The column is present ONLY for a
                    viewer who could act on some row; read-only viewers
                    used to get an unexplained empty column. */}
                {canWrite ? <th className="border border-gray-300 px-2 py-1 w-24"></th> : null}
              </tr>
            </thead>
            <tbody>
              {course.assessments.map((assessment) => {
                const maxima = assessmentMaxima(
                  assessment.items.map((item) => ({ sectionId: item.sectionId, maxMark: Number(item.maxMark) })),
                  assessment.sections,
                );
                return (
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
                  <td className="border border-gray-300 px-2 py-1 text-right whitespace-nowrap">
                    {assessment._count.items === 0 ? (
                      <span className="text-amber-700" title="No questions yet, so this assessment has no maximum">
                        not set
                      </span>
                    ) : maxima.hasOptionalSections ? (
                      <span title={`${formatMark(maxima.totalItemMarks)} marks are printed, but a section limits how many questions count`}>
                        {formatMark(maxima.obtainableMax)}{' '}
                        <span className="text-xs text-gray-500">of {formatMark(maxima.totalItemMarks)}</span>
                      </span>
                    ) : (
                      formatMark(maxima.obtainableMax)
                    )}
                  </td>
                  {/* An assessment with marks against it is deliberately
                      undeletable: removing it would destroy student data
                      and silently change every CO and PO figure derived
                      from it. Say so, rather than leaving a blank cell
                      that reads as a missing feature. */}
                  {canWrite ? (
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      {assessment._count.markValues === 0 ? (
                        <form action={deleteAssessmentAction.bind(null, courseId, assessment.id)}>
                          <button type="submit" className="text-red-700 hover:underline">delete</button>
                        </form>
                      ) : (
                        /* The same control, greyed out rather than absent
                           or replaced by prose: the row still shows what
                           the action WOULD be, and why it is unavailable.
                           An assessment carrying marks is deliberately
                           undeletable — removing it would destroy student
                           data and change every figure derived from it.
                           The count goes in the tooltip, where it belongs
                           as an explanation rather than as a column of
                           numbers competing with the maximum beside it. */
                        <button
                          type="button"
                          disabled
                          title={`Cannot delete: ${assessment._count.markValues} mark${assessment._count.markValues === 1 ? ' has' : 's have'} been recorded against this assessment. Deleting it would destroy them and change every figure computed from them — clear its marks first.`}
                          className="text-gray-400 cursor-not-allowed"
                        >
                          delete
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {writableGroups.length > 0 ? (
        <section className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <h3 className="font-medium">Add an assessment</h3>
          {/* Says why a group is missing rather than leaving the reader to
              wonder where "external" went (CR-3). */}
          {hiddenGroups.length > 0 ? (
            <p className="text-xs text-gray-600">
              The <b>{hiddenGroups.join(', ')}</b> {hiddenGroups.length === 1 ? 'group is' : 'groups are'} not listed
              below: on a theory course the end-semester examination is set by the Controller of Examinations. Marking a
              course as <b>Laboratory</b> on its Details tab hands the practical examination back to the department.
            </p>
          ) : null}
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
                {writableGroups.map((group) => (
                  <option key={group} value={group}>
                    {group} ({parameters.weightGroups[group]})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              {/* Plural: a single-score assessment IS the paper, so this
                  is its total — the end-semester paper's 75, not one
                  question's worth. */}
              <span className="block text-xs font-medium text-gray-700 mb-1">Maximum marks (single score)</span>
              <input name="maxMark" type="number" step="0.5" min={0} placeholder="75" className="border border-gray-300 rounded px-2 py-1.5 w-28" />
            </label>
            <button type="submit" className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800">Add</button>
          </form>
          <p className="text-xs text-gray-500">
            Cohort-band scoring applies to a single total score (the end-semester paper). Everything else uses the rubric.
          </p>
        </section>
      ) : null}

      {(canManageTemplates || canPublishTemplates) && course.assessments.length > 0 ? (
        <section className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-3xl">
          <h3 className="font-medium">Save as template</h3>
          <p className="text-xs text-gray-600">
            Captures this course&apos;s assessment structure (CO tags become CO-position slots) so every other course adopts
            it in one action.
          </p>
          <form action={saveTemplateFromCourseAction.bind(null, courseId)} className="space-y-2">
            <div className="flex gap-2">
              <input name="name" required placeholder="e.g. Standard UG theory paper" className="flex-1 border border-gray-300 rounded px-2 py-1.5" />
              <button type="submit" className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100">Save template</button>
            </div>
            {/*
              CR-3. Only the Controller of Examinations sees this choice —
              publishing a pattern for the whole college is theirs. An
              institution-wide template deliberately captures the EXTERNAL
              assessment only: every department sets its own internal
              tests, and one department's idea of those has no business
              landing on every course in the college.
            */}
            {canPublishTemplates ? (
              <fieldset className="text-xs text-gray-700 space-y-1">
                <legend className="sr-only">Who can use this template</legend>
                {canManageTemplates ? (
                  <label className="flex items-center gap-2">
                    <input type="radio" name="scope" value="department" defaultChecked className="h-3.5 w-3.5" />
                    <span>This department only — the whole structure</span>
                  </label>
                ) : null}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scope"
                    value="institution"
                    defaultChecked={!canManageTemplates}
                    className="h-3.5 w-3.5"
                  />
                  <span>
                    All departments — the <strong>external examination only</strong>, as the college&apos;s pattern
                  </span>
                </label>
              </fieldset>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
