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
  return (await resolveCourseParameterLayers(courseId)).resolved;
}

export interface CourseParameterLayers {
  /** What applies now, with provenance. */
  resolved: Step2Result;
  /** What would apply if the course's own overrides were removed. */
  inherited: Step2Result;
}

/**
 * Both resolutions in one query, for screens that must show a course
 * override *and* what removing it would restore.
 */
export async function resolveCourseParameterLayers(courseId: string): Promise<CourseParameterLayers> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: {
      batch: {
        include: { programme: { include: { department: { include: { institution: true } } } } },
      },
    },
  });
  const programme = course.batch.programme;
  const institution = institutionParameters(programme.department.institution);
  const programmeOverrides = parameterOverrides(programme);

  return {
    resolved: step2ResolveParameters(institution, programmeOverrides, parameterOverrides(course)),
    inherited: step2ResolveParameters(institution, programmeOverrides),
  };
}
