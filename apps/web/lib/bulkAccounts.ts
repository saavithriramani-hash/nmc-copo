/**
 * Bulk account import (§2.1), pure and testable. Turns decoded
 * spreadsheet rows into account rows, and diffs them against the
 * accounts that already exist so the UI can preview exactly what will be
 * created before anything is written — the same two-step shape as the
 * roster import (FR-10).
 *
 * Two rules are enforced here rather than left to the caller:
 *
 * - **Faculty is the only role the file may grant.** It is the one role
 *   that needs no scope and covers nearly every account a college
 *   creates in bulk. Every other role carries authority over other
 *   people's work — an institution-wide read-all, or the power to lock a
 *   course — and is granted deliberately, one at a time, on the accounts
 *   screen. A mistyped column must not be able to mint an administrator.
 *
 * - **An existing email is a skip, never an update.** Re-running a file
 *   after correcting three rows is the normal way this is used, so a
 *   second run has to be safe. Renaming an account that already exists
 *   would be an identity change, and belongs in a deliberate edit where
 *   the prior value is audited.
 */

/** Guards the synchronous commit: see the note on hashing in the action. */
export const MAX_IMPORT_ROWS = 500;

/**
 * Mirrors `normaliseEmail` from @copo/auth, deliberately duplicated
 * rather than imported.
 *
 * This module is pure and is imported by a CLIENT component. Importing
 * @copo/auth would reach its index, which reaches password.ts, which
 * loads the NATIVE argon2 binding — dragging a Node addon into the
 * browser bundle and breaking every page in the application, not just
 * this one. A unit test pins the two implementations together so they
 * cannot drift.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface AccountRow {
  fullName: string;
  /** Normalised (lower-cased, trimmed) — the identity, per §2.1. */
  email: string;
  /** True when the file asked for the Faculty role on this account. */
  grantFaculty: boolean;
  /** 1-based row in the source file, so the preview can point at it. */
  sourceRow: number;
}

export interface AccountParseError {
  row: number;
  message: string;
}

export interface AccountParseResult {
  rows: AccountRow[];
  errors: AccountParseError[];
  /** Which source column supplied each field (1-based), for the preview. */
  columns: { fullName: number; email: number; role: number | null };
  headerDetected: boolean;
}

const NAME_HEADERS = /^(full\s*name|staff(\s*name)?|name)$/i;
const EMAIL_HEADERS = /^(e-?mail(\s*address)?|college\s*e-?mail)$/i;
const ROLE_HEADERS = /^(role|designation)$/i;

/** The only role a file may grant, spelled the ways people actually write it. */
const FACULTY_SPELLINGS = /^(faculty|teacher|lecturer|staff)$/i;

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Interprets decoded rows. Uses a header row when one is present
 * (columns matched by name, in any order); otherwise assumes positional
 * columns: name, email, then an optional role.
 */
export function parseAccountRows(rows: string[][]): AccountParseResult {
  const errors: AccountParseError[] = [];
  const empty: AccountParseResult = {
    rows: [],
    errors: [{ row: 0, message: 'The file has no rows.' }],
    columns: { fullName: 1, email: 2, role: null },
    headerDetected: false,
  };
  if (rows.length === 0) return empty;

  const header = rows[0]!;
  let nameCol = header.findIndex((cell) => NAME_HEADERS.test(cell));
  let emailCol = header.findIndex((cell) => EMAIL_HEADERS.test(cell));
  let roleCol = header.findIndex((cell) => ROLE_HEADERS.test(cell));
  const headerDetected = nameCol !== -1 && emailCol !== -1;

  let dataStart = 0;
  if (headerDetected) {
    dataStart = 1;
  } else {
    // No recognisable header — assume positional columns. The email is
    // identified by shape, so a file written name-first or email-first
    // both work.
    const firstLooksLikeEmail = looksLikeEmail(header[0] ?? '');
    nameCol = firstLooksLikeEmail ? 1 : 0;
    emailCol = firstLooksLikeEmail ? 0 : 1;
    roleCol = header.length > 2 ? 2 : -1;
  }

  const parsed: AccountRow[] = [];
  const seen = new Map<string, number>();

  for (let i = dataStart; i < rows.length; i += 1) {
    const sourceRow = i + 1;
    const cells = rows[i]!;
    const fullName = (cells[nameCol] ?? '').trim();
    const emailRaw = (cells[emailCol] ?? '').trim();
    const roleRaw = roleCol >= 0 ? (cells[roleCol] ?? '').trim() : '';

    if (fullName === '' && emailRaw === '') continue; // stray blank line
    // The downloadable template carries '#' guidance lines. Forgetting to
    // delete them should not produce a page of parse errors.
    if ((cells[0] ?? '').trimStart().startsWith('#')) continue;

    if (emailRaw === '') {
      errors.push({ row: sourceRow, message: `Missing email address for “${fullName}”.` });
      continue;
    }
    if (!looksLikeEmail(emailRaw)) {
      errors.push({ row: sourceRow, message: `“${emailRaw}” is not a valid email address.` });
      continue;
    }
    if (fullName === '') {
      errors.push({ row: sourceRow, message: `Missing name for ${emailRaw}.` });
      continue;
    }

    // Compared normalised: Ravi@nmc.edu and ravi@nmc.edu are one person,
    // and the database would reject the second insert anyway.
    const email = normaliseEmail(emailRaw);
    const firstSeen = seen.get(email);
    if (firstSeen !== undefined) {
      errors.push({ row: sourceRow, message: `${email} also appears on row ${firstSeen} of this file.` });
      continue;
    }

    let grantFaculty = false;
    if (roleRaw !== '') {
      if (!FACULTY_SPELLINGS.test(roleRaw)) {
        errors.push({
          row: sourceRow,
          message: `“${roleRaw}” cannot be granted in bulk. Only Faculty can; grant any other role individually once the account exists.`,
        });
        continue;
      }
      grantFaculty = true;
    }

    seen.set(email, sourceRow);
    parsed.push({ fullName, email, grantFaculty, sourceRow });
  }

  return {
    rows: parsed,
    errors,
    columns: { fullName: nameCol + 1, email: emailCol + 1, role: roleCol >= 0 ? roleCol + 1 : null },
    headerDetected,
  };
}

export interface ExistingAccount {
  email: string;
  isActive: boolean;
}

export interface SkippedAccount {
  row: AccountRow;
  reason: string;
}

export interface AccountImportPlan {
  toCreate: AccountRow[];
  /** Already registered — left completely untouched. */
  skipped: SkippedAccount[];
}

/**
 * Diffs parsed rows against the accounts that already exist.
 *
 * A deactivated account is called out separately: re-creating the
 * address is impossible (email is unique) and reactivating it is almost
 * certainly what was meant, so the preview says so rather than reporting
 * a bare constraint failure at commit time.
 */
export function planAccountImport(rows: readonly AccountRow[], existing: readonly ExistingAccount[]): AccountImportPlan {
  const byEmail = new Map(existing.map((account) => [normaliseEmail(account.email), account]));
  const toCreate: AccountRow[] = [];
  const skipped: SkippedAccount[] = [];

  for (const row of rows) {
    const match = byEmail.get(row.email);
    if (!match) {
      toCreate.push(row);
      continue;
    }
    skipped.push({
      row,
      reason: match.isActive
        ? 'An account already exists for this address.'
        : 'A deactivated account exists for this address — reactivate it instead.',
    });
  }

  return { toCreate, skipped };
}

/** One line for the summary page of the handover PDF and the UI banner. */
export function describeImport(plan: AccountImportPlan, errors: readonly AccountParseError[]): string {
  const parts = [`${plan.toCreate.length} account${plan.toCreate.length === 1 ? '' : 's'} to create`];
  if (plan.skipped.length > 0) parts.push(`${plan.skipped.length} already registered`);
  if (errors.length > 0) parts.push(`${errors.length} row${errors.length === 1 ? '' : 's'} rejected`);
  return parts.join(' · ');
}
