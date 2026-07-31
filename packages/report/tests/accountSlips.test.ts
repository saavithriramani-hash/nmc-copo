import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderAccountSlips, type AccountSlipsData } from '../src/index';

/**
 * Handover slips (§2.1 bulk import).
 *
 * This document is the ONLY place a bulk import's temporary passwords
 * ever appear — they are never stored — so the assertions that matter
 * are that every password actually reaches the paper, and that the
 * summary tells the administrator what the import did.
 */

function inspectPdf(buffer: Buffer): { valid: boolean; pageCount: number } {
  const head = buffer.subarray(0, 5).toString('latin1');
  const tail = buffer.subarray(-1024).toString('latin1');
  const text = buffer.toString('latin1');
  const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { valid: head === '%PDF-' && tail.includes('%%EOF'), pageCount };
}

/** Inflates the content streams and collects the drawn strings. */
function extractText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const pieces: string[] = [];
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) continue;
    const chunk = Buffer.from(raw.slice(start, end), 'latin1');
    let content: string;
    try {
      content = zlib.inflateSync(chunk).toString('latin1');
    } catch {
      content = chunk.toString('latin1');
    }
    for (const array of content.matchAll(/\[((?:[^\][])*)\]\s*TJ/g)) {
      let run = '';
      for (const hex of array[1]!.matchAll(/<([0-9a-fA-F]*)>/g)) {
        run += Buffer.from(hex[1]!, 'hex').toString('latin1');
      }
      for (const literal of array[1]!.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
        run += literal[1]!.replace(/\\([()\\])/g, '$1');
      }
      if (run) pieces.push(run);
    }
    for (const literal of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')/g)) {
      pieces.push(literal[1]!.replace(/\\([()\\])/g, '$1'));
    }
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) {
      pieces.push(Buffer.from(hex[1]!, 'hex').toString('latin1'));
    }
  }
  return pieces.join(' ');
}

function buildData(overrides: Partial<AccountSlipsData> = {}): AccountSlipsData {
  return {
    institutionName: 'Nehru Memorial College (Autonomous)',
    administratorName: 'System Administrator',
    generatedAt: new Date('2026-07-31T10:00:00Z'),
    sourceFileName: 'faculty-2026.xlsx',
    created: [
      { fullName: 'Ravi Kumar', email: 'ravi@nmc.edu', temporaryPassword: 'ABCD-EFGH-IJKL', grantedFaculty: true },
      { fullName: 'Meena S', email: 'meena@nmc.edu', temporaryPassword: 'MNPQ-RSTU-VWXY', grantedFaculty: true },
      { fullName: 'Anand P', email: 'anand@nmc.edu', temporaryPassword: 'ZABC-DEFG-HIJK', grantedFaculty: false },
    ],
    skipped: [{ email: 'existing@nmc.edu', reason: 'An account already exists for this address.' }],
    rejected: [{ row: 7, message: '“Dean” cannot be granted in bulk.' }],
    ...overrides,
  };
}

describe('account handover slips', () => {
  it('produces a valid multi-page PDF', async () => {
    const buffer = await renderAccountSlips(buildData());
    const info = inspectPdf(buffer);
    expect(info.valid).toBe(true);
    expect(info.pageCount).toBeGreaterThanOrEqual(2); // summary, then slips
  });

  it('prints EVERY temporary password — a missing one is an account nobody can reach', async () => {
    const data = buildData();
    const text = extractText(await renderAccountSlips(data));
    for (const slip of data.created) {
      expect(text, `password for ${slip.email}`).toContain(slip.temporaryPassword);
      expect(text, `name for ${slip.email}`).toContain(slip.fullName);
      expect(text, `email ${slip.email}`).toContain(slip.email);
    }
  });

  it('states what the import did, including what it refused', async () => {
    const text = extractText(await renderAccountSlips(buildData()));
    expect(text).toContain('Account import summary');
    expect(text).toContain('faculty-2026.xlsx');
    expect(text).toContain('Already registered');
    expect(text).toContain('existing@nmc.edu');
    expect(text).toContain('Rows rejected');
    expect(text).toContain('cannot be granted in bulk');
  });

  it('tells the holder to change the password, and warns the administrator to destroy the sheet', async () => {
    const text = extractText(await renderAccountSlips(buildData()));
    expect(text).toMatch(/change this password at first sign-in/i);
    expect(text).toMatch(/destroy/i);
    expect(text).toMatch(/in person/i);
  });

  it('distinguishes an account that got Faculty from one that got no role', async () => {
    const text = extractText(await renderAccountSlips(buildData()));
    expect(text).toContain('Role: Faculty');
    expect(text).toMatch(/No role yet/i);
  });

  it('paginates a full college intake without dropping anyone', async () => {
    const created = Array.from({ length: 240 }, (_, i) => ({
      fullName: `Staff Member ${i + 1}`,
      email: `staff${i + 1}@nmc.edu`,
      temporaryPassword: `AA${String(i).padStart(2, '0')}-BBBB-CCCC`,
      grantedFaculty: true,
    }));
    const buffer = await renderAccountSlips(buildData({ created, skipped: [], rejected: [] }));
    expect(inspectPdf(buffer).valid).toBe(true);

    const text = extractText(buffer);
    // The last one matters most: it is the one a broken page break loses.
    expect(text).toContain('AA239-BBBB-CCCC');
    expect(text).toContain('Staff Member 240');
    const printed = created.filter((slip) => text.includes(slip.temporaryPassword));
    expect(printed).toHaveLength(created.length);
  });

  it('renders a clean import — nothing skipped, nothing rejected', async () => {
    const buffer = await renderAccountSlips(buildData({ skipped: [], rejected: [] }));
    const text = extractText(buffer);
    expect(inspectPdf(buffer).valid).toBe(true);
    // The counts stay in the summary (both read 0); it is the SECTIONS
    // that must not appear, so an empty table is never printed.
    expect(text).toContain('Rows rejected 0');
    expect(text).not.toContain('left untouched');
    expect(text).not.toContain('no account was created');
  });

  it('renders an import that created nothing at all', async () => {
    // Every row was a duplicate — a re-run of an already-imported file.
    // The administrator still needs the record of why.
    const buffer = await renderAccountSlips(buildData({ created: [] }));
    const text = extractText(buffer);
    expect(inspectPdf(buffer).valid).toBe(true);
    expect(text).toContain('Account import summary');
    expect(text).not.toContain('Handover slips');
  });
});
