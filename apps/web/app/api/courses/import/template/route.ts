import { NextResponse } from 'next/server';
import { importableBatches } from '@/lib/courseImportData';
import { buildCourseImportTemplateBuffer, courseImportTemplateFileName } from '@/lib/courseImportTemplateFile';
import { getSessionUser } from '@/lib/session';

/**
 * The course import template (CR-11), with a dropdown of every batch the
 * caller may create courses in. Someone who may create courses nowhere
 * gets a 404, as for every other resource they cannot reach.
 */
export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const batches = await importableBatches(user.userId);
  if (batches.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const buffer = await buildCourseImportTemplateBuffer(batches.map((batch) => batch.label));
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${courseImportTemplateFileName()}"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
