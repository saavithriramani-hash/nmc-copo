import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { ENGINE_VERSION } from '@copo/engine';
import { buildLearningOutcomeWorkbook } from '@copo/export';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { knowledgeLevelReport } from '@/lib/knowledgeLevels';
import { getSessionUser } from '@/lib/session';

/**
 * The learning outcome workbook for one question paper (CR-7).
 *
 * `marks.read`, not `course.read`: the file names every student and what
 * they earned, so it is the department chain's alone (NFR-10). The
 * screen shows the blueprint and the class figures more widely — those
 * carry no register number — but the file does not separate them, so the
 * stricter permission governs it.
 */
export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { courseId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'marks.read', courseId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const assessmentId = new URL(request.url).searchParams.get('assessmentId');
  if (!assessmentId) return NextResponse.json({ error: 'assessmentId is required' }, { status: 400 });

  const report = await knowledgeLevelReport(courseId, assessmentId);
  if (!report) {
    return NextResponse.json({ error: 'That assessment has no question tagged with a knowledge level.' }, { status: 404 });
  }

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      code: true,
      title: true,
      batch: { select: { name: true, programme: { select: { name: true, department: { select: { name: true } } } } } },
    },
  });

  const buffer = await buildLearningOutcomeWorkbook({
    course: {
      code: course.code,
      title: course.title,
      programmeName: course.batch.programme.name,
      batchName: course.batch.name,
      departmentName: course.batch.programme.department.name,
    },
    assessment: report.assessment,
    // Paper order, and only the tagged questions — the same set every
    // figure in the report was computed from.
    questions: report.questions,
    // Same order as result.students, which follows the enrolment order.
    students: report.result.students.map((student) => report.studentById[student.studentId] ?? { registerNumber: '', fullName: '' }),
    result: report.result,
    generatedAt: new Date(),
    engineVersion: ENGINE_VERSION,
  });

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_REPORT_EXPORTED',
    entityType: 'Course',
    entityId: courseId,
    after: { format: 'learning-outcome.xlsx', assessmentId },
  });

  const safe = course.code.replace(/[^A-Za-z0-9_-]/g, '_');
  const name = `Learning_Outcome_${safe}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
