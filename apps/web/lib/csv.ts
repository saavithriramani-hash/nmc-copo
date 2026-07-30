/**
 * CSV encoding for the institutional data export — pure and tested.
 *
 * RFC 4180: fields containing a comma, a quote or a newline are wrapped
 * in quotes and embedded quotes are doubled. A null is written as an
 * EMPTY field, and the manifest records which columns are nullable, so
 * "no value" never becomes the string "null" or a zero.
 */

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(',');
}

/** A whole file, with the header row first and a trailing newline. */
export function csvDocument(headers: string[], rows: unknown[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join('\n') + '\n';
}
