/**
 * Delimited-text parser for pasted (TSV, from a spreadsheet clipboard) or
 * uploaded CSV data. Pure and dependency-free so it is unit-testable;
 * handles quoted fields, embedded delimiters/newlines, and "" escapes
 * (RFC 4180). Excel (.xlsx) uploads are decoded separately (lib/spreadsheet).
 */

/** Auto-detects tab vs comma from the first line (spreadsheet paste is tab). */
export function detectDelimiter(text: string): '\t' | ',' {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > 0 && tabs >= commas ? '\t' : ',';
}

/** Parses delimited text into a grid of trimmed-per-cell string rows. */
export function parseDelimited(text: string, delimiter?: '\t' | ','): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delim) {
      pushField();
    } else if (char === '\n') {
      pushRow();
    } else if (char === '\r') {
      // swallow; \r\n handled by the \n branch
    } else {
      field += char;
    }
  }
  // Trailing field/row unless the text ended exactly on a newline.
  if (field !== '' || row.length > 0) pushRow();

  // Drop wholly empty rows (blank lines), and trim every cell.
  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
}
