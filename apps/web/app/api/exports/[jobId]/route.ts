import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { guard } from '@/lib/authz';
import { exportPath } from '@/lib/dataExport';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/session';

/** Streams a finished institutional data export (NFR-12). */
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
  if (!job || job.kind !== 'INSTITUTIONAL_EXPORT') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (job.status !== 'COMPLETED') {
    return NextResponse.json({ error: `Export is ${job.status.toLowerCase()}` }, { status: 409 });
  }

  const file = exportPath(jobId);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: 'The export file is no longer on disk; run it again.' }, { status: 410 });
  }

  const result = job.result as { fileName?: string } | null;
  await logAudit({
    actorId: user.userId,
    action: 'INSTITUTIONAL_EXPORT_DOWNLOADED',
    entityType: 'Job',
    entityId: jobId,
    after: { bytes: size },
  });

  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result?.fileName ?? `COPO_Export_${jobId}.zip`}"`,
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  });
}
