import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { applyFilter, renderProgrammeConsolidation } from '@copo/report';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { buildProgrammeConsolidation } from '@/lib/reportData';
import { getSessionUser } from '@/lib/session';

/**
 * Programme consolidation PDF (FR-20), optionally narrowed to a semester
 * or a batch via ?semester= and ?batch=.
 */
export async function GET(request: Request, context: { params: Promise<{ programmeId: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { programmeId } = await context.params;
  try {
    await guard.require(user.userId, { type: 'programme.read', programmeId });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const url = new URL(request.url);
  const semesterRaw = url.searchParams.get('semester');
  const batchName = url.searchParams.get('batch') ?? undefined;
  const semester = semesterRaw ? Number(semesterRaw) : undefined;
  const filter = {
    ...(semester !== undefined && Number.isInteger(semester) ? { semester } : {}),
    ...(batchName ? { batchName } : {}),
  };

  const data = await buildProgrammeConsolidation(programmeId, filter);
  data.rows = applyFilter(data.rows, filter);
  const pdf = await renderProgrammeConsolidation(data);

  await logAudit({
    actorId: user.userId,
    action: 'PROGRAMME_CONSOLIDATION_EXPORTED',
    entityType: 'Programme',
    entityId: programmeId,
    after: { format: 'pdf', filter, courses: data.rows.length },
  });

  const name = `Consolidation_${data.meta.scopeLabel.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
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
