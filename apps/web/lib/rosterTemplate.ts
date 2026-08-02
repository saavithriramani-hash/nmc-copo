/**
 * The blank roster-import template (FR-10).
 *
 * Pure, so the one thing that actually matters can be asserted without a
 * database or a browser: that what we hand out is something
 * `parseRosterRows` reads back exactly as intended. A template whose
 * headers the importer does not recognise is worse than no template — it
 * silently falls back to positional columns.
 *
 * CSV rather than a workbook, like the account template: it opens in
 * Excel, in LibreOffice and in Notepad, and there is nothing to install.
 */

/** The header row. Every name here must satisfy the importer's patterns. */
export const ROSTER_TEMPLATE_HEADERS = ['Register number', 'Full name', 'Email'] as const;

/**
 * Two example rows, meant to be typed over, and guidance as '#' comments
 * the importer skips.
 *
 * The examples show the two shapes a row can take — with an email and
 * without — because the email column is optional and staff otherwise ask.
 */
export const ROSTER_TEMPLATE_EXAMPLES: readonly string[][] = [
  ['24PHY001', 'Anitha Rajan', 'anitha.r@example.edu'],
  ['24PHY002', 'Bala Subramanian', ''],
];

/**
 * Guidance, as rows the importer skips.
 *
 * Comma-free on purpose. A comma would be quoted by the encoder below,
 * and the line would open in Notepad as `"# ..."` — still correct, still
 * skipped, but no longer recognisable as a comment to the person reading
 * the file.
 */
const GUIDANCE = [
  '# Delete these example rows and comment lines before importing.',
  '# The register number identifies the student and must be unique in this batch.',
  '# Email is optional — leave it empty rather than inventing one.',
  '# A student already on this roster is left unchanged and never overwritten.',
];

/** The template as rows, exactly as the importer would receive them. */
export function rosterTemplateRows(): string[][] {
  return [[...ROSTER_TEMPLATE_HEADERS], ...ROSTER_TEMPLATE_EXAMPLES.map((row) => [...row]), [], ...GUIDANCE.map((line) => [line])];
}

/**
 * CSV encoding (RFC 4180). Quotes any field containing a comma, a quote
 * or a newline — a name like "Rajan, Anitha" would otherwise split into
 * two columns. Exported so it can be tested against those inputs directly
 * rather than only against the template, none of whose fields need it.
 */
export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','),
    )
    .join('\r\n');
}

export function rosterTemplateCsv(): string {
  return toCsv(rosterTemplateRows());
}

/** A filename staff can recognise months later, safe on every filesystem. */
export function rosterTemplateFileName(batchName: string): string {
  const safe = batchName
    .replace(/[^A-Za-z0-9]+/g, '-') // an en dash in "2024–2027" among others
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return safe ? `roster-template-${safe}.csv` : 'roster-template.csv';
}
