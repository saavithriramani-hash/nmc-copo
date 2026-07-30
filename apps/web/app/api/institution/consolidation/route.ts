import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { applyFilter, renderInstitutionConsolidation } from '@copo/report';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { buildInstitutionConsolidation } from '@/lib/reportData';
import { getSessionUser } from '@/lib/session';

/** Institution consolidation PDF (FR-21) — institution.read. */
export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    await guard.require(user.userId, { type: 'institution.read' });
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

  const data = await buildInstitutionConsolidation(filter);
  data.rows = applyFilter(data.rows, filter);
  const pdf = await renderInstitutionConsolidation(data);

  await logAudit({
    actorId: user.userId,
    action: 'INSTITUTION_CONSOLIDATION_EXPORTED',
    entityType: 'Institution',
    entityId: 'institution',
    after: { format: 'pdf', filter, courses: data.rows.length },
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="Institution_Consolidation.pdf"',
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
