/**
 * Roster import logic (FR-10), pure and testable. Turns decoded
 * spreadsheet rows into roster entries, and diffs them against the
 * batch's existing roster so the UI can preview exactly what will be
 * created before anything is written. Register numbers are the identity;
 * they are entered here, once per batch, and never typed into a course.
 */

export interface RosterEntry {
  registerNumber: string;
  fullName: string;
  email: string | null;
}

export interface RosterParseError {
  /** 1-based row number in the source file. */
  row: number;
  message: string;
}

export interface RosterParseResult {
  entries: RosterEntry[];
  errors: RosterParseError[];
  /** Which source column supplied each field (1-based), for the preview. */
  columns: { registerNumber: number; fullName: number; email: number | null };
  headerDetected: boolean;
}

const REG_HEADERS = /^(reg(ister)?|roll|enroll?ment)\.?\s*(no\.?|number|num)?$/i;
const NAME_HEADERS = /^(full\s*name|student(\s*name)?|name)$/i;
const EMAIL_HEADERS = /^(e-?mail(\s*address)?)$/i;

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Interprets decoded rows. Uses a header row when one is present
 * (columns matched by name, in any order); otherwise assumes positional
 * columns: register number, name, then an optional email.
 */
export function parseRosterRows(rows: string[][]): RosterParseResult {
  const errors: RosterParseError[] = [];
  if (rows.length === 0) {
    return {
      entries: [],
      errors: [{ row: 0, message: 'The file has no rows.' }],
      columns: { registerNumber: 1, fullName: 2, email: null },
      headerDetected: false,
    };
  }

  const header = rows[0]!;
  let regCol = header.findIndex((cell) => REG_HEADERS.test(cell));
  let nameCol = header.findIndex((cell) => NAME_HEADERS.test(cell));
  let emailCol = header.findIndex((cell) => EMAIL_HEADERS.test(cell));
  const headerDetected = regCol !== -1 && nameCol !== -1;

  let dataStart = 0;
  if (headerDetected) {
    dataStart = 1;
  } else {
    // No recognisable header — assume positional columns.
    regCol = 0;
    nameCol = 1;
    emailCol = header.length > 2 && looksLikeEmail(header[2] ?? '') ? 2 : -1;
  }

  const entries: RosterEntry[] = [];
  const seen = new Set<string>();

  for (let i = dataStart; i < rows.length; i += 1) {
    const sourceRow = i + 1;
    const cells = rows[i]!;
    const registerNumber = (cells[regCol] ?? '').trim();
    const fullName = (cells[nameCol] ?? '').trim();
    const emailRaw = emailCol >= 0 ? (cells[emailCol] ?? '').trim() : '';

    if (registerNumber === '' && fullName === '') continue; // stray blank line
    // The downloadable template carries '#' guidance lines, as the account
    // template does. Left in place they would otherwise import as students
    // named after the instructions — a comment is not a register number.
    if ((cells[0] ?? '').trimStart().startsWith('#')) continue;

    if (registerNumber === '') {
      errors.push({ row: sourceRow, message: 'Missing register number.' });
      continue;
    }
    if (fullName === '') {
      errors.push({ row: sourceRow, message: `Missing name for register number ${registerNumber}.` });
      continue;
    }
    if (seen.has(registerNumber)) {
      errors.push({ row: sourceRow, message: `Duplicate register number ${registerNumber} within the file.` });
      continue;
    }
    if (emailRaw !== '' && !looksLikeEmail(emailRaw)) {
      errors.push({ row: sourceRow, message: `“${emailRaw}” is not a valid email address.` });
      continue;
    }
    seen.add(registerNumber);
    entries.push({ registerNumber, fullName, email: emailRaw === '' ? null : emailRaw });
  }

  return {
    entries,
    errors,
    columns: { registerNumber: regCol + 1, fullName: nameCol + 1, email: emailCol >= 0 ? emailCol + 1 : null },
    headerDetected,
  };
}

export interface RosterImportPlan {
  toCreate: RosterEntry[];
  /** Already on the roster (matched by register number) — left unchanged. */
  alreadyPresent: RosterEntry[];
}

/** Diffs parsed entries against the batch's existing register numbers. */
export function planRosterImport(entries: RosterEntry[], existingRegisterNumbers: Iterable<string>): RosterImportPlan {
  const existing = new Set(existingRegisterNumbers);
  const toCreate: RosterEntry[] = [];
  const alreadyPresent: RosterEntry[] = [];
  for (const entry of entries) {
    if (existing.has(entry.registerNumber)) alreadyPresent.push(entry);
    else toCreate.push(entry);
  }
  return { toCreate, alreadyPresent };
}
