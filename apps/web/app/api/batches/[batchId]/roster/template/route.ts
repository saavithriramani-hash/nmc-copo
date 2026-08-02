import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { rosterTemplateCsv, rosterTemplateFileName } from '@/lib/rosterTemplate';
import { getSessionUser } from '@/lib/session';

/**
 * A blank roster-import template for one batch (FR-10).
 *
 * **Blank, unlike the mark template, which is deliberately pre-filled.**
 * That one must carry the marks already recorded, because an empty cell
 * means "did not attempt" and uploading an empty sheet would blank them.
 * Roster import only ever creates: a register number already present is
 * left untouched, so there is nothing here for a blank file to destroy —
 * and a file pre-filled with 4,000 names would be a chore to edit and a
 * copy of the roster loose on somebody's laptop besides.
 *
 * Guarded by `roster.manage`, the same action as the import it feeds, so
 * the download cannot be a way around it. A route handler rather than a
 * page, so the browser downloads it; it authorises itself, because
 * layouts do not wrap route handlers.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { batchId } = await context.params;
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { name: true, programme: { select: { departmentId: true } } },
  });

  try {
    // A batch that does not exist yields no department, which no role can
    // match — so a guessed id and a forbidden one are refused alike.
    await guard.require(user.userId, {
      type: 'roster.manage',
      departmentId: batch?.programme.departmentId ?? '',
    });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  // BOM so Excel opens it as UTF-8 and does not mangle Tamil or accented
  // names — the reason this is not a bare `new Response(csv)`.
  const body = `﻿${rosterTemplateCsv()}`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${rosterTemplateFileName(batch?.name ?? '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
