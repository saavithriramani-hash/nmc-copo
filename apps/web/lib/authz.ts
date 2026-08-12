import { Guard, PrismaAuditSink, PrismaContextSource } from '@copo/auth';
import { prisma } from './db';

/**
 * THE authorisation choke point for the whole app. Every server action
 * and every data-loading decision goes through guard.require /
 * guard.check — no permission logic exists in page components.
 */
export const auditSink = new PrismaAuditSink(prisma);
export const guard = new Guard(new PrismaContextSource(prisma), auditSink);

/**
 * The weight group holding the end-semester examination (§4.4).
 *
 * The engine treats weight groups as opaque keys — `Record<string,
 * number>` — so this is the single place the application asserts which
 * of them is the external one. CR-3 hangs an authority boundary on it:
 * the Controller of Examinations owns assessments in this group on a
 * theory paper, and nothing else.
 */
export const EXTERNAL_WEIGHT_GROUP = 'external';

/**
 * Which permission governs an assessment, given the group it sits in.
 *
 * The external examination is the COE's on a theory course and the
 * department's on a practical one; everything else belongs to the course
 * chain. The policy decides the laboratory fallback itself — it can see
 * `isLaboratory` on the course — so all that is needed here is the
 * choice of action.
 */
export async function requireAssessmentWrite(
  userId: string,
  courseId: string,
  weightGroup: string,
): Promise<void> {
  await guard.require(userId, {
    type: weightGroup === EXTERNAL_WEIGHT_GROUP ? 'assessment.external.write' : 'course.write',
    courseId,
  });
}

/** The same choice for entering the marks. */
export async function requireMarksWrite(userId: string, courseId: string, weightGroup: string): Promise<void> {
  await guard.require(userId, {
    type: weightGroup === EXTERNAL_WEIGHT_GROUP ? 'marks.external.write' : 'marks.write',
    courseId,
  });
}

/** Non-throwing form, for deciding what a screen should offer. */
export async function canWriteAssessment(userId: string, courseId: string, weightGroup: string): Promise<boolean> {
  const decision = await guard.check(userId, {
    type: weightGroup === EXTERNAL_WEIGHT_GROUP ? 'assessment.external.write' : 'course.write',
    courseId,
  });
  return decision.allow;
}

/** Non-throwing form, for deciding what a screen should offer. */
export async function canWriteMarks(userId: string, courseId: string, weightGroup: string): Promise<boolean> {
  const decision = await guard.check(userId, {
    type: weightGroup === EXTERNAL_WEIGHT_GROUP ? 'marks.external.write' : 'marks.write',
    courseId,
  });
  return decision.allow;
}
