import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { renderCourseReport } from '@copo/report';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { loadCourseReportData } from '@/lib/reportData';
import { getSessionUser } from '@/lib/session';

/** Course PDF report (FR-19). */
export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { courseId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'course.read', courseId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const data = await loadCourseReportData(courseId);
  const pdf = await renderCourseReport(data);

  await logAudit({
    actorId: user.userId,
    action: 'COURSE_REPORT_EXPORTED',
    entityType: 'Course',
    entityId: courseId,
    after: { format: 'pdf', version: data.course.snapshotVersion },
  });

  const version = data.course.snapshotVersion === null ? 'live' : `v${data.course.snapshotVersion}`;
  const name = `CO-PO_${data.course.code.replace(/[^A-Za-z0-9_-]/g, '_')}_${version}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
