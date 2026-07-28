import { notFound } from 'next/navigation';
import { ThresholdEditor } from '@/components/ThresholdEditor';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { resolveCourseParameterLayers } from '@/lib/params';
import { requireSession } from '@/lib/session';
import { describeSource, formatThresholdPercent, thresholdExample } from '@/lib/courseThreshold';

/**
 * Course parameter overrides (§4, FR-3). Presently the rubric threshold.
 *
 * The effective value and its provenance come from the engine's own
 * Step 2, not from a re-implementation here, so what this screen shows
 * is by construction what the computation and the report will use.
 *
 * Editing is `settings.course.write` — the HoD of the course's
 * department, and nobody else, never on a LOCKED course. Everyone who
 * can read the course sees the value read-only.
 */
export default async function CourseSettingsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireSession();
  const { courseId } = await params;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { status: true, thresholdFraction: true },
  });
  if (!course) notFound();

  // Both resolutions come from the engine's own Step 2 (lib/params), so
  // the value shown is by construction the value computed with.
  const { resolved, inherited } = await resolveCourseParameterLayers(courseId);

  const canEdit = (await guard.check(user.userId, { type: 'settings.course.write', courseId })).allow;
  const override = course.thresholdFraction === null ? null : Number(course.thresholdFraction);
  const effective = resolved.parameters.thresholdFraction;

  return (
    <div className="space-y-4">
      {canEdit ? (
        <ThresholdEditor
          courseId={courseId}
          override={override}
          effective={effective}
          sourceLabel={describeSource(resolved.provenance.thresholdFraction)}
          inheritedFraction={inherited.parameters.thresholdFraction}
        />
      ) : (
        <div className="bg-white border border-gray-300 rounded p-4 space-y-2 max-w-2xl">
          <h2 className="font-medium">Rubric threshold</h2>
          <p className="text-sm">
            In force: <strong>{formatThresholdPercent(effective)}%</strong>{' '}
            <span className="text-gray-600">— from {describeSource(resolved.provenance.thresholdFraction)}.</span>
          </p>
          <p className="text-xs text-gray-600">{thresholdExample(effective, 10)}.</p>
          <p className="text-xs text-gray-500">
            {course.status === 'LOCKED'
              ? 'This course is locked; its parameters can no longer be changed. Unlock it to make a change, which creates a new version.'
              : 'Only the Head of this course’s department may change it — a course-level threshold records a minuted exception.'}
          </p>
        </div>
      )}
    </div>
  );
}
