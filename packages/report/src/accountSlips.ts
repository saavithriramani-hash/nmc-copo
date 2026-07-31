import { ReportDoc } from './doc';
import { COLOR, CONTENT, FONT, SIZE } from './theme';

/**
 * Handover slips for a bulk account import (§2.1).
 *
 * This document exists because the single-account flow does not scale:
 * one temporary password can be read off the screen and written down;
 * three hundred cannot. There is no mail server to fall back on — NFR-5
 * rules out external service dependencies — so the credentials have to
 * leave the system on paper.
 *
 * Two decisions follow from that, and both are deliberate:
 *
 * - **Slips, not a list.** Each person gets a cut-out carrying only
 *   their own password. A single sheet listing everyone's would mean
 *   handing one person the credentials of all the others every time it
 *   was consulted.
 * - **A summary page first.** The administrator needs a record of what
 *   the import actually did — created, skipped, rejected and why — and
 *   this is the one artefact they keep. It doubles as the paperwork.
 *
 * This PDF is generated once, in the same request that creates the
 * accounts, and is never stored: no job row, no file on disk. If a slip
 * goes astray the account's password is reset individually.
 */

export interface AccountSlip {
  fullName: string;
  email: string;
  temporaryPassword: string;
  /** Whether the import also granted the Faculty role. */
  grantedFaculty: boolean;
}

export interface SkippedRow {
  email: string;
  reason: string;
}

export interface RejectedRow {
  row: number;
  message: string;
}

export interface AccountSlipsData {
  institutionName: string;
  /** Who ran the import, for the record. */
  administratorName: string;
  generatedAt: Date;
  sourceFileName: string;
  created: AccountSlip[];
  skipped: SkippedRow[];
  rejected: RejectedRow[];
}

/** Slip geometry: two columns down the page, cut along the rules. */
const SLIP = {
  columns: 2,
  gutter: 16,
  height: 128,
  padding: 10,
} as const;

export async function renderAccountSlips(data: AccountSlipsData): Promise<Buffer> {
  const doc = new ReportDoc(
    {
      title: 'Account handover slips',
      context: data.institutionName,
      subtitle: `Imported from ${data.sourceFileName} · ${data.generatedAt.toLocaleString()}`,
    },
    'Contains live passwords — hand over in person, then destroy this document.',
  );

  writeSummary(doc, data);
  if (data.created.length > 0) writeSlips(doc, data.created);

  return doc.finish();
}

function writeSummary(doc: ReportDoc, data: AccountSlipsData): void {
  doc.title('Account import summary');

  doc.keyValues([
    ['Institution', data.institutionName],
    ['Imported by', data.administratorName],
    ['Source file', data.sourceFileName],
    ['Generated', data.generatedAt.toISOString()],
    ['Accounts created', String(data.created.length)],
    ['Already registered (skipped)', String(data.skipped.length)],
    ['Rows rejected', String(data.rejected.length)],
    ['Faculty role granted', String(data.created.filter((slip) => slip.grantedFaculty).length)],
  ]);

  doc.space(6);
  doc.paragraph(
    'The pages that follow carry one slip per new account, each with a temporary password that is shown here and nowhere else. Cut them apart and hand each one to its holder in person. The password must be changed at first sign-in. Destroy this document once every slip has been handed over; if one is lost, reset that account’s password individually rather than re-running the import.',
    { size: SIZE.small },
  );

  if (data.skipped.length > 0) {
    doc.space(8);
    doc.heading('Already registered — left untouched');
    doc.paragraph('These addresses already have accounts. Nothing about them was changed.', { size: SIZE.small });
    doc.table(
      [
        { header: 'Email', width: 220 },
        { header: 'Why it was skipped', width: CONTENT.width - 220 },
      ],
      data.skipped.map((row) => [{ text: row.email }, { text: row.reason }]),
      { zebra: true },
    );
  }

  if (data.rejected.length > 0) {
    doc.space(8);
    doc.heading('Rows rejected — no account was created');
    doc.paragraph('Correct these rows in the source file and import it again; the accounts already created above will be skipped on the second run.', {
      size: SIZE.small,
    });
    doc.table(
      [
        { header: 'Row', width: 44, align: 'right' },
        { header: 'Reason', width: CONTENT.width - 44 },
      ],
      data.rejected.map((row) => [{ text: String(row.row) }, { text: row.message }]),
      { zebra: true },
    );
  }
}

function writeSlips(doc: ReportDoc, slips: readonly AccountSlip[]): void {
  doc.newPage();
  doc.heading('Handover slips');
  doc.paragraph('Cut along the lines. Each slip carries one person’s password and no one else’s.', {
    size: SIZE.small,
  });
  doc.space(4);

  const columnWidth = (CONTENT.width - SLIP.gutter * (SLIP.columns - 1)) / SLIP.columns;

  slips.forEach((slip, index) => {
    const column = index % SLIP.columns;
    // A new row of slips begins whenever we wrap back to the first
    // column; the page break is taken there so a slip is never split.
    if (column === 0) {
      doc.ensure(SLIP.height + 6);
      if (index > 0) doc.space(SLIP.height + 6);
    }

    const x = CONTENT.left + column * (columnWidth + SLIP.gutter);
    drawSlip(doc, slip, x, doc.cursor, columnWidth);
  });

  // The cursor sat at the top of the final row while it was drawn.
  doc.space(SLIP.height + 6);
}

function drawSlip(doc: ReportDoc, slip: AccountSlip, x: number, y: number, width: number): void {
  const pdf = doc.pdf;
  pdf.save();

  pdf.dash(2, { space: 2 }).roundedRect(x, y, width, SLIP.height, 3).lineWidth(0.6).strokeColor(COLOR.rule).stroke();
  pdf.undash();

  const inner = x + SLIP.padding;
  const innerWidth = width - SLIP.padding * 2;
  let cursor = y + SLIP.padding;

  const line = (text: string, options: { font?: string; size?: number; color?: string; gap?: number } = {}) => {
    pdf
      .font(options.font ?? FONT.regular)
      .fontSize(options.size ?? SIZE.small)
      .fillColor(options.color ?? COLOR.ink)
      .text(text, inner, cursor, { width: innerWidth, lineBreak: false, ellipsis: true });
    cursor += (options.size ?? SIZE.small) + (options.gap ?? 3);
  };

  line(slip.fullName, { font: FONT.bold, size: SIZE.subheading, gap: 2 });
  line(slip.email, { size: SIZE.small, color: COLOR.muted, gap: 6 });

  line('Temporary password', { size: SIZE.tiny, color: COLOR.faint, gap: 2 });
  // Courier: the password is transcribed by hand, and a monospaced face
  // is what separates 1 from l and 0 from O.
  line(slip.temporaryPassword, { font: 'Courier-Bold', size: 12, gap: 6 });

  line(
    slip.grantedFaculty
      ? 'Role: Faculty. Change this password at first sign-in.'
      : 'No role yet — ask the administrator. Change this password at first sign-in.',
    { size: SIZE.tiny, color: COLOR.muted },
  );

  pdf.restore();
}
