'use server';

import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { requireSession } from '@/lib/session';
import { decodeSpreadsheet } from '@/lib/spreadsheet';
import {
  MAX_IMPORT_ROWS,
  describeImport,
  parseAccountRows,
  planAccountImport,
  type AccountParseError,
  type AccountRow,
  type SkippedAccount,
} from '@/lib/bulkAccounts';

/**
 * Bulk account import, step 1 (§2.1).
 *
 * Parses an uploaded file and returns a full preview of what WOULD
 * happen — nothing is written. The client shows it, then posts the same
 * file to /api/admin/accounts/bulk to commit.
 *
 * The file is deliberately re-read and re-planned at commit rather than
 * the preview's rows being trusted: the preview is a display, not an
 * authorisation, and an account could be created by someone else in
 * between.
 */

export type BulkAccountsPreview =
  | { ok: false; error: string }
  | {
      ok: true;
      fileName: string;
      headerDetected: boolean;
      columns: { fullName: number; email: number; role: number | null };
      toCreate: AccountRow[];
      skipped: SkippedAccount[];
      parseErrors: AccountParseError[];
      summary: string;
    };

export async function previewBulkAccountsAction(formData: FormData): Promise<BulkAccountsPreview> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'users.manage' });

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV or Excel file.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'File is larger than 5 MB.' };

  let grid: string[][];
  try {
    grid = await decodeSpreadsheet(file);
  } catch {
    return { ok: false, error: 'Could not read the file. Save it as .xlsx or .csv and try again.' };
  }

  const parsed = parseAccountRows(grid);
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `This file has ${parsed.rows.length} accounts; the limit is ${MAX_IMPORT_ROWS} at a time. Split it and import each part.`,
    };
  }

  const plan = planAccountImport(parsed.rows, await existingAccounts(parsed.rows));

  return {
    ok: true,
    fileName: file.name,
    headerDetected: parsed.headerDetected,
    columns: parsed.columns,
    toCreate: plan.toCreate,
    skipped: plan.skipped,
    parseErrors: parsed.errors,
    summary: describeImport(plan, parsed.errors),
  };
}

/**
 * The accounts already registered among the addresses in the file.
 *
 * Scoped to those addresses rather than loading every account: a college
 * has thousands, and only the ones named here can collide.
 */
export async function existingAccounts(rows: readonly AccountRow[]): Promise<{ email: string; isActive: boolean }[]> {
  if (rows.length === 0) return [];
  return prisma.user.findMany({
    where: { email: { in: rows.map((row) => row.email) } },
    select: { email: true, isActive: true },
  });
}
