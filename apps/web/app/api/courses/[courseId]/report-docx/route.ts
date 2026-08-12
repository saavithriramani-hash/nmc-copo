import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { renderCourseReportDocx } from '@copo/report';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { loadCourseReportData } from '@/lib/reportData';
import { getSessionUser } from '@/lib/session';

/**
 * The course report as a Word document (FR-19).
 *
 * Deliberately the same shape as the PDF route beside it — same guard,
 * same data loader, same audit action with the format recorded — so the
 * two cannot drift in who may read a course or in what gets logged. Only
 * the renderer and the content type differ.
 */
export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { courseId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'course.read', courseId });
  } catch (err) {
    // 404, not 403: a course out of reach must look exactly like one that
    // does not exist.
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const data = await loadCourseReportData(courseId);
  const docx = await renderCourseReportDocx(data);

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_REPORT_EXPORTED',
    entityType: 'Course',
    entityId: courseId,
    after: { format: 'docx', version: data.course.snapshotVersion },
  });

  const version = data.course.snapshotVersion === null ? 'live' : `v${data.course.snapshotVersion}`;
  const name = `CO-PO_${data.course.code.replace(/[^A-Za-z0-9_-]/g, '_')}_${version}.docx`;
  return new NextResponse(new Uint8Array(docx), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(docx.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
