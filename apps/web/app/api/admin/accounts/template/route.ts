import { NextResponse } from 'next/server';
import { AuthzDeniedError } from '@copo/auth';
import { guard } from '@/lib/authz';
import { getSessionUser } from '@/lib/session';

/**
 * A blank import template.
 *
 * CSV rather than a workbook, deliberately: it opens in Excel, in
 * LibreOffice and in Notepad, and there is nothing to go wrong on a
 * machine with no spreadsheet installed. The two example rows show the
 * shape — one with a role, one without — and are meant to be typed over.
 */
export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    await guard.require(user.userId, { type: 'users.manage' });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const csv = [
    'Full name,Email,Role',
    'Ravi Kumar,ravi.kumar@example.edu,Faculty',
    'Meena Sundaram,meena.s@example.edu,',
    '',
    '# Role may only say Faculty, or be left blank. Every other role is',
    '# granted individually on the Accounts & roles screen.',
    '# Delete these example and comment lines before importing.',
  ].join('\r\n');

  // BOM so Excel opens it as UTF-8 and does not mangle accented names.
  const body = `﻿${csv}`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="account-import-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
