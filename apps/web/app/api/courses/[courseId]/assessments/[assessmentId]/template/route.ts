import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { buildMarkTemplateBuffer } from '@/lib/markTemplateFile';
import { markKey, templateFileName, type TemplateItem } from '@/lib/markTemplate';
import { getSessionUser } from '@/lib/session';

/**
 * Downloads the mark-entry template for one assessment (FR-12): the
 * enrolled students down, the questions across, mark cells empty.
 *
 * Guarded by `marks.write`, not `marks.read` — the file exists to be
 * filled in and uploaded, and it carries the roster (register numbers and
 * names), which NFR-10 keeps to the course faculty and their department
 * chain. A route handler rather than a page, so the browser downloads it;
 * it authorises itself, because layouts do not wrap route handlers.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; assessmentId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { courseId, assessmentId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'marks.write', courseId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      courseId: true,
      name: true,
      shape: true,
      sections: {
        orderBy: { displayOrder: 'asc' },
        select: { name: true, items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } } },
      },
      items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } },
      course: { select: { code: true, title: true } },
    },
  });
  // A guessed id and one from another course look the same.
  if (!assessment || assessment.courseId !== courseId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Same column order the mark grid uses, so the two read alike.
  const items: TemplateItem[] =
    assessment.shape === 'SECTIONED'
      ? assessment.sections.flatMap((section) =>
          section.items.map((item) => ({
            id: item.id,
            label: item.label,
            maxMark: Number(item.maxMark),
            sectionName: section.name,
          })),
        )
      : assessment.items.map((item) => ({
          id: item.id,
          label: item.label,
          maxMark: Number(item.maxMark),
          sectionName: null,
        }));

  if (items.length === 0) {
    return NextResponse.json({ error: 'This assessment has no questions yet.' }, { status: 409 });
  }

  const enrolments = await prisma.enrolment.findMany({
    where: { courseId },
    orderBy: { rosterEntry: { registerNumber: 'asc' } },
    select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
  });

  // Marks already recorded, so the sheet is a working one. Without this
  // an upload would blank every existing mark, since an empty cell means
  // "did not attempt". One assessment's marks only (NFR-1).
  const stored = await prisma.markValue.findMany({
    where: { assessmentId },
    select: { enrolmentId: true, itemId: true, value: true },
  });
  const registerByEnrolment = new Map(enrolments.map((e) => [e.id, e.rosterEntry.registerNumber]));
  const existing = new Map<string, number | null>();
  for (const mark of stored) {
    const registerNumber = registerByEnrolment.get(mark.enrolmentId);
    if (registerNumber === undefined) continue;
    existing.set(markKey(registerNumber, mark.itemId), mark.value === null ? null : Number(mark.value));
  }

  const buffer = await buildMarkTemplateBuffer({
    courseCode: assessment.course.code,
    courseTitle: assessment.course.title,
    assessmentName: assessment.name,
    items,
    students: enrolments.map((e) => ({
      registerNumber: e.rosterEntry.registerNumber,
      studentName: e.rosterEntry.student.fullName,
    })),
    existing,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${templateFileName(assessment.course.code, assessment.name)}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
