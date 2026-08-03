import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { marksForAssessment } from '@copo/db';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { assignSheetNames, courseWorkbookFileName } from '@/lib/courseWorkbook';
import { buildCourseWorkbookBuffer, type CourseWorkbookSheet } from '@/lib/courseWorkbookFile';
import { markKey, type TemplateItem } from '@/lib/markTemplate';
import { getSessionUser } from '@/lib/session';

/**
 * The whole course's mark workbook (FR-12): every assessment on its own
 * sheet, the enrolled students down, the questions across, **carrying
 * every mark already recorded**.
 *
 * That pre-fill is the safety property, not a convenience. An empty cell
 * imports as "did not attempt", so a blank workbook uploaded over a
 * part-marked course would blank every assessment at once. An untouched
 * download proposes no changes at all.
 *
 * Guarded by `marks.write`, like the single-assessment template: the file
 * exists to be filled in and returned, and it carries the roster, which
 * NFR-10 keeps to the course faculty and their department chain.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { courseId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'marks.write', courseId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      code: true,
      title: true,
      assessments: {
        orderBy: { displayOrder: 'asc' },
        select: {
          id: true,
          name: true,
          shape: true,
          sections: {
            orderBy: { displayOrder: 'asc' },
            select: { name: true, items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } } },
          },
          items: { orderBy: { displayOrder: 'asc' }, select: { id: true, label: true, maxMark: true } },
        },
      },
    },
  });
  if (!course) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const enrolments = await prisma.enrolment.findMany({
    where: { courseId },
    orderBy: { rosterEntry: { registerNumber: 'asc' } },
    select: { id: true, rosterEntry: { select: { registerNumber: true, student: { select: { fullName: true } } } } },
  });
  if (enrolments.length === 0) {
    return NextResponse.json({ error: 'No students are enrolled in this course yet.' }, { status: 409 });
  }

  // An assessment with no questions has no columns to offer, so it gets
  // no sheet — and is excluded from the upload's expectations too, so it
  // is never reported as a sheet somebody forgot.
  const withItems = course.assessments.filter((assessment) =>
    assessment.shape === 'SECTIONED'
      ? assessment.sections.some((section) => section.items.length > 0)
      : assessment.items.length > 0,
  );
  if (withItems.length === 0) {
    return NextResponse.json({ error: 'No assessment in this course has any questions yet.' }, { status: 409 });
  }

  const sheetNames = assignSheetNames(withItems);
  const registerByEnrolment = new Map(enrolments.map((e) => [e.id, e.rosterEntry.registerNumber]));

  // One indexed query per assessment rather than one over the course:
  // bounded by the assessment's own size, never the 25M-row table (NFR-1).
  const existing = new Map<string, number | null>();
  for (const assessment of withItems) {
    for (const mark of await marksForAssessment(prisma, assessment.id)) {
      const registerNumber = registerByEnrolment.get(mark.enrolmentId);
      if (registerNumber === undefined) continue;
      existing.set(markKey(registerNumber, mark.itemId), mark.value);
    }
  }

  const sheets: CourseWorkbookSheet[] = withItems.map((assessment) => {
    // Same column order the mark grid and the single-assessment template
    // use, so all three read alike.
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
    return { sheetName: sheetNames.get(assessment.id)!, assessmentName: assessment.name, items };
  });

  const buffer = await buildCourseWorkbookBuffer({
    courseCode: course.code,
    courseTitle: course.title,
    students: enrolments.map((e) => ({
      registerNumber: e.rosterEntry.registerNumber,
      studentName: e.rosterEntry.student.fullName,
    })),
    sheets,
    existing,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${courseWorkbookFileName(course.code)}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
