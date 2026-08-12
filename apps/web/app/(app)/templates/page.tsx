import { redirect } from 'next/navigation';
import { deleteTemplateAction } from '@/actions/templates';
import { prisma } from '@/lib/db';
import { parsePattern } from '@/lib/setupPlans';
import { requireSession } from '@/lib/session';

/**
 * Assessment templates (FR-8) — the HoD's department patterns, and since
 * CR-3 the Controller of Examinations' institution-wide external
 * examination patterns.
 */
export default async function TemplatesPage() {
  const user = await requireSession();
  const isCoe = user.roles.some((role) => role.kind === 'COE');
  if (user.hodDepartmentIds.length === 0 && !isCoe) redirect('/');

  const templates = await prisma.assessmentTemplate.findMany({
    where: {
      OR: [
        // An HoD's own departments…
        ...(user.hodDepartmentIds.length > 0 ? [{ departmentId: { in: user.hodDepartmentIds } }] : []),
        // …and the institution-wide ones, which everybody here can adopt
        // even though only the COE may publish or remove them.
        { departmentId: null },
      ],
    },
    include: { department: true },
    orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
  });

  const summarise = (value: unknown): string => {
    try {
      const pattern = parsePattern(value);
      return pattern.assessments
        .map((assessment) => {
          if (assessment.shape === 'SECTIONED') {
            const sections = assessment.sections ?? [];
            const items = sections.reduce((sum, section) => sum + section.items.length, 0);
            return `${assessment.name} (${sections.length} sections, ${items} questions)`;
          }
          if (assessment.shape === 'ITEM_LIST') return `${assessment.name} (${(assessment.items ?? []).length} items)`;
          return `${assessment.name} (single score /${assessment.maxMark})`;
        })
        .join(' · ');
    } catch {
      return 'malformed pattern';
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Assessment templates</h1>
      <p className="text-xs text-gray-600 max-w-2xl">
        A template captures a course&apos;s whole assessment structure — &quot;two CIAs of four sections, a quiz, a seminar,
        an assignment&quot; — and any course of the department adopts it in one action. Create one from a well-built
        course: open that course → Assessments → <b>Save as template</b>.
      </p>
      {isCoe ? (
        <p className="text-xs text-gray-600 max-w-2xl">
          Templates marked <b>All departments</b> are yours: the college&apos;s external examination pattern, adoptable
          on any course. They capture the <b>external assessment only</b> — each department sets its own internal
          tests. Publish one by opening a course whose end-semester paper is set up correctly, then Assessments →
          Save as template → <b>All departments</b>.
        </p>
      ) : null}

      {templates.length === 0 ? (
        <p className="text-gray-600">No templates yet.</p>
      ) : (
        <table className="w-full bg-white border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="border border-gray-300 px-2 py-1 w-56">Template</th>
              <th className="border border-gray-300 px-2 py-1 w-40">Department</th>
              <th className="border border-gray-300 px-2 py-1">Structure</th>
              <th className="border border-gray-300 px-2 py-1 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <td className="border border-gray-300 px-2 py-1 font-medium">{template.name}</td>
                {/* No department = the COE's institution-wide external
                    examination pattern, adoptable anywhere (CR-3). */}
                <td className="border border-gray-300 px-2 py-1">
                  {template.department?.name ?? <span className="text-blue-800">All departments</span>}
                </td>
                <td className="border border-gray-300 px-2 py-1 text-xs">{summarise(template.pattern)}</td>
                {/* Deleting an institution-wide pattern is the COE's; a
                    department's own is its HoD's. Offered only to whoever
                    that is, rather than shown and then refused. */}
                <td className="border border-gray-300 px-2 py-1 text-center">
                  <form action={deleteTemplateAction.bind(null, template.id)}>
                    {(template.departmentId === null ? isCoe : user.hodDepartmentIds.includes(template.departmentId)) ? (
                      <button type="submit" className="text-red-700 hover:underline">delete</button>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
