import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { guard } from '@/lib/authz';
import { bundlePath } from '@/lib/bundle';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/**
 * Streams a finished accreditation bundle (FR-22). Streamed rather than
 * buffered: a whole-institution bundle can be hundreds of megabytes and
 * must not be held in memory.
 */
export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    await guard.require(user.userId, { type: 'institution.read' });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const { jobId } = await context.params;
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.kind !== 'ACCREDITATION_BUNDLE') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (job.status !== 'COMPLETED') {
    return NextResponse.json({ error: `Bundle is ${job.status.toLowerCase()}` }, { status: 409 });
  }

  const file = bundlePath(jobId);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: 'The bundle file is no longer on disk; run it again.' }, { status: 410 });
  }

  const result = job.result as { fileName?: string } | null;
  const fileName = result?.fileName ?? `Accreditation_Bundle_${jobId}.zip`;

  await logAudit({
    actorId: user.userId,
    action: 'BUNDLE_DOWNLOADED',
    entityType: 'Job',
    entityId: jobId,
    after: { bytes: size },
  });

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  });
}
