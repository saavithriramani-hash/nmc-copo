import { NextResponse } from 'next/server';
import { AccountService, AuthzDeniedError, RoleService } from '@copo/auth';
import { renderAccountSlips } from '@copo/report';
import { existingAccounts } from '@/actions/bulkAccounts';
import { auditSink, guard } from '@/lib/authz';
import { MAX_IMPORT_ROWS, parseAccountRows, planAccountImport } from '@/lib/bulkAccounts';
import { prisma } from '@/lib/db';
import { getSessionUser, sessions } from '@/lib/session';
import { decodeSpreadsheet } from '@/lib/spreadsheet';

/**
 * Bulk account import, step 2 (§2.1): create the accounts and hand back
 * the handover slips.
 *
 * This is a route rather than a server action because the response IS
 * the PDF. That is the whole point: the temporary passwords are created,
 * printed and returned inside a single request, and never written
 * anywhere. Not to a Job row, not to a file, not into a URL. If the
 * download is lost, the passwords are gone and each account's password
 * is reset individually — which is the correct outcome, not a gap.
 *
 * The file is parsed and planned again here rather than trusting
 * anything the client posts back from the preview. The preview is a
 * display; this is the decision.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    await guard.require(user.userId, { type: 'users.manage' });
  } catch (err) {
    if (err instanceof AuthzDeniedError) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    throw err;
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a CSV or Excel file.' }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File is larger than 5 MB.' }, { status: 400 });
  }

  let grid: string[][];
  try {
    grid = await decodeSpreadsheet(file);
  } catch {
    return NextResponse.json({ error: 'Could not read the file.' }, { status: 400 });
  }

  const parsed = parseAccountRows(grid);
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `This file has ${parsed.rows.length} accounts; the limit is ${MAX_IMPORT_ROWS} at a time.` },
      { status: 400 },
    );
  }

  const plan = planAccountImport(parsed.rows, await existingAccounts(parsed.rows));

  const accounts = new AccountService(prisma, guard, sessions, auditSink);
  const roles = new RoleService(prisma, guard, auditSink);

  const created = await accounts.createUsers(
    user.userId,
    plan.toCreate.map((row) => ({ email: row.email, fullName: row.fullName })),
  );

  // Faculty is the only role the file can ask for, and it carries no
  // scope — see lib/bulkAccounts.ts for why nothing else is allowed.
  // Granted after creation so a role failure cannot cost the caller the
  // passwords of accounts that were created successfully.
  const wantsFaculty = new Map(plan.toCreate.map((row) => [row.email, row.grantFaculty]));
  const effectiveFrom = new Date();
  const grantFailures: string[] = [];
  for (const account of created) {
    if (!wantsFaculty.get(account.email)) continue;
    try {
      await roles.grantRole(user.userId, { userId: account.userId, kind: 'FACULTY', effectiveFrom });
    } catch {
      grantFailures.push(account.email);
    }
  }

  const pdf = await renderAccountSlips({
    institutionName: (await prisma.institution.findFirst({ select: { name: true } }))?.name ?? 'Institution',
    administratorName: user.fullName,
    generatedAt: new Date(),
    sourceFileName: file.name,
    created: created.map((account) => ({
      fullName: account.fullName,
      email: account.email,
      temporaryPassword: account.temporaryPassword,
      grantedFaculty: (wantsFaculty.get(account.email) ?? false) && !grantFailures.includes(account.email),
    })),
    skipped: plan.skipped.map((entry) => ({ email: entry.row.email, reason: entry.reason })),
    rejected: parsed.errors.map((error) => ({ row: error.row, message: error.message })),
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Account-slips_${stamp}.pdf"`,
      'Content-Length': String(pdf.byteLength),
      // Never cached: this document contains live credentials.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      // Lets the page report the outcome without parsing the PDF.
      'X-Import-Created': String(created.length),
      'X-Import-Skipped': String(plan.skipped.length),
      'X-Import-Rejected': String(parsed.errors.length),
    },
  });
}
