import { step2ResolveParameters } from '@copo/engine';
import type { Step2Result } from '@copo/engine';
import { institutionParameters, parameterOverrides } from '@copo/db';
import { prisma } from './db';

/**
 * Resolves the attainment parameters that apply to a course
 * (institution → programme → course, §4) through the engine's own Step 2,
 * so provenance shown in the UI is the engine's. Used by the assessment
 * builder for the weight-group list.
 */
export async function resolveCourseParameters(courseId: string): Promise<Step2Result> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: {
      batch: {
        include: { programme: { include: { department: { include: { institution: true } } } } },
      },
    },
  });
  const programme = course.batch.programme;
  return step2ResolveParameters(
    institutionParameters(programme.department.institution),
    parameterOverrides(programme),
    parameterOverrides(course),
  );
}
