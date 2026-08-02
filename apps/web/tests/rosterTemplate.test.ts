import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../lib/delimited';
import { parseRosterRows } from '../lib/roster';
import {
  ROSTER_TEMPLATE_EXAMPLES,
  ROSTER_TEMPLATE_HEADERS,
  rosterTemplateCsv,
  rosterTemplateFileName,
  toCsv,
} from '../lib/rosterTemplate';

/**
 * The template is only useful if the importer reads back exactly what we
 * handed out. These tests walk the real path a downloaded file takes when
 * it is uploaded again — bytes → text → grid → entries — rather than
 * asserting against a hand-written copy of what we think we emit.
 *
 * Everything but exceljs is the production code: the route's BOM, the
 * WHATWG text decode a File upload performs, `parseDelimited`, and
 * `parseRosterRows` itself.
 */
async function downloadThenUpload(): Promise<string[][]> {
  // Exactly what the route sends, BOM included.
  const body = `\ufeff${rosterTemplateCsv()}`;
  const file = new File([body], 'roster-template.csv', { type: 'text/csv' });
  return parseDelimited(await file.text());
}

describe('the roster template round-trips through the importer', () => {
  it('the byte-order mark does not become part of the first header', async () => {
    // Excel needs the BOM to read UTF-8; if it survived the decode, the
    // first header would be "\ufeffRegister number" and match nothing.
    const grid = await downloadThenUpload();
    expect(grid[0]).toEqual([...ROSTER_TEMPLATE_HEADERS]);
  });

  it('its header row is recognised — not silently read as data', async () => {
    // The failure this guards against is quiet: an unrecognised header
    // falls back to positional columns and imports "Register number" as a
    // student called "Full name".
    const parsed = parseRosterRows(await downloadThenUpload());
    expect(parsed.headerDetected).toBe(true);
    expect(parsed.columns).toEqual({ registerNumber: 1, fullName: 2, email: 3 });
  });

  it('the example rows parse cleanly, with no errors at all', async () => {
    const parsed = parseRosterRows(await downloadThenUpload());
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([
      { registerNumber: '24PHY001', fullName: 'Anitha Rajan', email: 'anitha.r@example.edu' },
      { registerNumber: '24PHY002', fullName: 'Bala Subramanian', email: null },
    ]);
  });

  it('the guidance lines are skipped, not imported as students', async () => {
    // Left in place by someone who did not read the first line of them, a
    // '#' row would otherwise become a student named after the advice.
    const parsed = parseRosterRows(await downloadThenUpload());
    expect(parsed.entries.some((entry) => entry.fullName.startsWith('#'))).toBe(false);
    expect(parsed.entries).toHaveLength(ROSTER_TEMPLATE_EXAMPLES.length);
    expect(parsed.errors).toHaveLength(0);
  });

  it('one example carries an email and one does not, since the column is optional', async () => {
    const parsed = parseRosterRows(await downloadThenUpload());
    expect(parsed.entries.filter((entry) => entry.email !== null)).toHaveLength(1);
    expect(parsed.entries.filter((entry) => entry.email === null)).toHaveLength(1);
  });

  it('an untouched template proposes no students at all once the examples go', async () => {
    // What a careful user actually does: delete the examples, keep the
    // headers, add nobody. That must be an empty import, not an error.
    const grid = (await downloadThenUpload()).filter((row) => !/^24PHY/.test(row[0] ?? ''));
    const parsed = parseRosterRows(grid);
    expect(parsed.entries).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes a field containing a comma, so a name cannot split into two columns', () => {
    expect(toCsv([['Rajan, Anitha']])).toBe('"Rajan, Anitha"');
  });

  it('doubles an embedded quote, per RFC 4180', () => {
    expect(toCsv([['O"Brien']])).toBe('"O""Brien"');
  });

  it('leaves an ordinary field alone', () => {
    expect(toCsv([['Bala Subramanian', '24PHY002']])).toBe('Bala Subramanian,24PHY002');
  });

  it('a quoted field survives the round trip through the parser', () => {
    // The property that matters, rather than the encoding in isolation.
    const grid = parseDelimited(toCsv([['24PHY003', 'Rajan, Anitha', 'r@example.edu']]));
    expect(grid[0]).toEqual(['24PHY003', 'Rajan, Anitha', 'r@example.edu']);
  });

  it('uses CRLF, which Excel expects', () => {
    const csv = rosterTemplateCsv();
    expect(csv).toContain('\r\n');
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('every guidance line reads as a comment in a plain text editor too', () => {
    // Not just after parsing: a quoted '"# ..."' would still be skipped,
    // but would no longer look like guidance to whoever opens the file.
    const lines = rosterTemplateCsv().split('\r\n');
    const prose = lines.slice(1 + ROSTER_TEMPLATE_EXAMPLES.length).filter((line) => line.trim() !== '');
    expect(prose.length).toBeGreaterThan(0);
    expect(prose.every((line) => line.startsWith('#'))).toBe(true);
  });
});

describe('rosterTemplateFileName', () => {
  it('turns the batch name into something every filesystem accepts', () => {
    // The en dash is the point: batch names are written "2024–2027".
    expect(rosterTemplateFileName('2024–2027')).toBe('roster-template-2024-2027.csv');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    expect(rosterTemplateFileName('  B.Sc. Physics / 2023–2026 ')).toBe('roster-template-B-Sc-Physics-2023-2026.csv');
  });

  it('falls back to a plain name when nothing usable survives', () => {
    expect(rosterTemplateFileName('—')).toBe('roster-template.csv');
    expect(rosterTemplateFileName('')).toBe('roster-template.csv');
  });

  it('never returns a path, nor breaks out of the Content-Disposition quotes', () => {
    for (const hostile of ['../../etc/passwd', 'a"; filename="b', 'C:\\Windows\\system32']) {
      const name = rosterTemplateFileName(hostile);
      expect(name).not.toMatch(/[/\\"']/);
      expect(name).not.toContain('..');
    }
  });
});
