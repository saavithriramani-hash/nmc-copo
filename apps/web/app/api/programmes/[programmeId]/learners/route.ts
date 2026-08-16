import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { ENGINE_VERSION } from '@copo/engine';
import { buildLearnerCategoryWorkbook } from '@copo/export';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { learnerCategoryReport } from '@/lib/learnerCategories';
import { getSessionUser } from '@/lib/session';

/**
 * The slow and advanced learner workbook for one batch and semester
 * (CR-8, NAAC 2.2.1).
 *
 * `learners.read`, not `programme.read`: the file is a roll of named
 * students labelled by learning ability, so it stops at the department
 * chain on the same reasoning NFR-10 applies to marks. The counts on the
 * screen are readable more widely — they name nobody — but the file does
 * not separate them, so the stricter permission governs it. A denial
 * answers 404 rather than 403, as every other guarded download here does:
 * whether a cohort exists is itself something the caller may not know.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ programmeId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { programmeId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'learners.read', programmeId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const url = new URL(request.url);
  const batchId = url.searchParams.get('batchId');
  const semesterParam = url.searchParams.get('semester');
  if (!batchId || !semesterParam) {
    return NextResponse.json({ error: 'batchId and semester are required' }, { status: 400 });
  }
  const semester = Number(semesterParam);
  if (!Number.isInteger(semester)) {
    return NextResponse.json({ error: 'semester must be a whole number' }, { status: 400 });
  }

  const report = await learnerCategoryReport(programmeId, batchId, semester);
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const buffer = await buildLearnerCategoryWorkbook({
    programme: { name: report.programme.name, departmentName: report.programme.departmentName },
    batch: report.batch,
    semester: report.semester,
    criteria: report.criteria,
    courses: report.courses,
    students: report.roster,
    scores: report.courseScores,
    bands: report.applied.bands,
    bandSource: report.applied.source,
    result: report.result,
    generatedAt: new Date(),
    engineVersion: ENGINE_VERSION,
  });

  await logAudit({
    actorId: user.userId,
    action: 'LEARNER_REPORT_EXPORTED',
    entityType: 'Programme',
    entityId: programmeId,
    after: { batchId, semester },
  });

  const safe = `${report.batch.name}_Sem${report.semester}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const name = `Slow_and_Advanced_Learners_${safe}.xlsx`;
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
