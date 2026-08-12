import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StructureEditor } from '@/components/StructureEditor';
import { canWriteAssessment } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { resolveCourseParameters } from '@/lib/params';
import { requireSession } from '@/lib/session';

export default async function AssessmentEditorPage({
  params,
}: {
  params: Promise<{ courseId: string; assessmentId: string }>;
}) {
  const user = await requireSession();
  const { courseId, assessmentId } = await params;

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      sections: {
        orderBy: { displayOrder: 'asc' },
        include: { items: { orderBy: { displayOrder: 'asc' } } },
      },
      items: { orderBy: { displayOrder: 'asc' } },
      coTags: true,
      _count: { select: { markValues: true } },
    },
  });
  if (!assessment || assessment.courseId !== courseId) notFound();

  // CR-3: who may edit a structure depends on the group it sits in, not
  // on the course alone. The end-semester paper of a theory course is the
  // Controller of Examinations'; everything else, and the whole of a
  // practical course, is the course chain's.
  const [canEdit, { parameters }] = await Promise.all([
    canWriteAssessment(user.userId, courseId, assessment.weightGroup),
    resolveCourseParameters(courseId),
  ]);

  // The editor can move an assessment between groups, so offer only the
  // groups this person could move it INTO — the action refuses the rest,
  // and a dropdown that leads to a refusal is a trap.
  const writableGroups: string[] = [];
  for (const group of Object.keys(parameters.weightGroups)) {
    if (await canWriteAssessment(user.userId, courseId, group)) writableGroups.push(group);
  }
  const cos = await prisma.courseOutcome.findMany({
    where: { courseId },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, code: true },
  });

  const singleItem = assessment.shape === 'SINGLE_SCORE' ? assessment.items[0] : undefined;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        <Link href={`/courses/${courseId}/assessments`} className="text-blue-700 hover:underline">← All assessments</Link>
        {' · '}
        {assessment.shape} · {assessment._count.markValues > 0 ? `${assessment._count.markValues} marks recorded` : 'no marks yet'}
      </p>
      <StructureEditor
        assessmentId={assessment.id}
        shape={assessment.shape}
        canEdit={canEdit}
        cos={cos}
        weightGroups={writableGroups}
        thresholdFraction={parameters.thresholdFraction}
        initial={{
          name: assessment.name,
          weightGroup: assessment.weightGroup,
          scoringRule: assessment.scoringRule,
          sections: assessment.sections.map((section) => ({
            id: section.id,
            name: section.name,
            optionalAnswerCount: section.optionalAnswerCount,
            items: section.items.map((item) => ({
              id: item.id,
              label: item.label,
              maxMark: item.maxMark.toNumber(),
              coId: item.coId,
            })),
          })),
          items:
            assessment.shape === 'ITEM_LIST'
              ? assessment.items.map((item) => ({ id: item.id, label: item.label, maxMark: item.maxMark.toNumber(), coId: item.coId }))
              : [],
          singleMaxMark: singleItem ? singleItem.maxMark.toNumber() : null,
          coTagIds: assessment.coTags.map((tag) => tag.coId),
        }}
      />
    </div>
  );
}
