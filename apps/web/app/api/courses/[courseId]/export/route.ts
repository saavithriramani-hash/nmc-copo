import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { ENGINE_VERSION } from '@copo/engine';
import { buildWorkbookBuffer, exportFileName, type ExportInput } from '@copo/export';
import { guard } from '@/lib/authz';
import { getCourseAttainment } from '@/lib/compute';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getSessionUser } from '@/lib/session';

/**
 * Excel export of a course (FR-18). A route handler rather than a page,
 * so the browser downloads the file; it authorises itself, because
 * layouts do not wrap route handlers.
 */
export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { courseId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'course.read', courseId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    select: {
      code: true,
      title: true,
      semester: true,
      status: true,
      batch: { select: { name: true, programme: { select: { name: true, department: { select: { name: true } } } } } },
    },
  });

  const attainment = await getCourseAttainment(courseId);

  const data: ExportInput = {
    course: {
      code: course.code,
      title: course.title,
      semester: course.semester,
      departmentName: course.batch.programme.department.name,
      programmeName: course.batch.programme.name,
      batchName: course.batch.name,
      status: course.status,
      snapshotVersion: attainment.version,
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date(),
    },
    input: attainment.input,
    result: attainment.result,
    refs: attainment.refs,
    // A locked snapshot does not carry provenance; the parameters sheet
    // says so rather than inventing a level.
    provenance: attainment.parameterResolution?.provenance ?? null,
  };

  const buffer = await buildWorkbookBuffer(data);
  await logAudit({
    actorId: user.userId,
    action: 'COURSE_EXPORTED',
    entityType: 'Course',
    entityId: courseId,
    after: { format: 'xlsx', source: attainment.source, version: attainment.version },
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exportFileName(data)}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
