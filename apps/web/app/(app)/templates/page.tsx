import { redirect } from 'next/navigation';
import { deleteTemplateAction } from '@/actions/templates';
import { prisma } from '@/lib/db';
import { parsePattern } from '@/lib/setupPlans';
import { requireSession } from '@/lib/session';

/** Department assessment templates (FR-8) — HoD view. */
export default async function TemplatesPage() {
  const user = await requireSession();
  if (user.hodDepartmentIds.length === 0) redirect('/');

  const templates = await prisma.assessmentTemplate.findMany({
    where: { departmentId: { in: user.hodDepartmentIds } },
    include: { department: true },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
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
        course: open that course → Assessments → <b>Save as department template</b>.
      </p>

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
                <td className="border border-gray-300 px-2 py-1">{template.department.name}</td>
                <td className="border border-gray-300 px-2 py-1 text-xs">{summarise(template.pattern)}</td>
                <td className="border border-gray-300 px-2 py-1 text-center">
                  <form action={deleteTemplateAction.bind(null, template.id)}>
                    <button type="submit" className="text-red-700 hover:underline">delete</button>
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
