import Link from 'next/link';
import { notFound } from 'next/navigation';
import { marksForAssessment } from '@copo/db';
import { MarkEntry } from '@/components/MarkEntry';
import type { GridColumn, GridMark, GridStudent } from '@/components/MarkGrid';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

export default async function MarkEntryPage({ params }: { params: Promise<{ courseId: string; assessmentId: string }> }) {
  const user = await requireSession();
  const { courseId, assessmentId } = await params;

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      courseId: true,
      name: true,
      shape: true,
      sections: { orderBy: { displayOrder: 'asc' }, select: { name: true, items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } } } },
      items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true, sectionId: true } },
    },
  });
  if (!assessment || assessment.courseId !== courseId) notFound();

  // Marks are visible only to the course faculty and their department chain (NFR-10).
  const canRead = (await guard.check(user.userId, { type: 'marks.read', courseId })).allow;
  if (!canRead) notFound();
  const canEdit = (await guard.check(user.userId, { type: 'marks.write', courseId })).allow;

  // Columns in display order, grouped by section for SECTIONED.
  const columns: GridColumn[] =
    assessment.shape === 'SECTIONED'
      ? assessment.sections.flatMap((section) =>
          section.items.map((item) => ({ itemId: item.id, label: item.label, maxMark: item.maxMark.toNumber(), sectionName: section.name })),
        )
      : assessment.items.map((item) => ({ itemId: item.id, label: item.label, maxMark: item.maxMark.toNumber(), sectionName: null }));

  const enrolments = await prisma.enrolment.findMany({
    where: { courseId },
    orderBy: { rosterEntry: { registerNumber: 'asc' } },
    select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
  });
  const students: GridStudent[] = enrolments.map((e) => ({
    enrolmentId: e.id,
    registerNumber: e.rosterEntry.registerNumber,
    studentName: e.rosterEntry.student.fullName,
  }));

  const initial: GridMark[] = await marksForAssessment(prisma, assessmentId);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        <Link href={`/courses/${courseId}/marks`} className="text-blue-700 hover:underline">← All assessments</Link> ·{' '}
        <span className="font-medium">{assessment.name}</span> · {students.length} students × {columns.length} items
      </p>
      {students.length === 0 ? (
        <p className="text-gray-600">
          No students enrolled. Draw enrolment from the roster on the{' '}
          <Link href={`/courses/${courseId}/enrolment`} className="text-blue-700 hover:underline">Enrolment</Link> tab.
        </p>
      ) : columns.length === 0 ? (
        <p className="text-gray-600">
          This assessment has no items yet. Add them on the{' '}
          <Link href={`/courses/${courseId}/assessments/${assessmentId}`} className="text-blue-700 hover:underline">assessment structure</Link> page.
        </p>
      ) : (
        <MarkEntry courseId={courseId} assessmentId={assessmentId} students={students} columns={columns} initial={initial} canEdit={canEdit} />
      )}
    </div>
  );
}
