import { describe, expect, it } from 'vitest';
import { csvDocument, csvField, csvRow } from '../lib/csv';

describe('csvField — RFC 4180', () => {
  it('leaves plain values alone', () => {
    expect(csvField('MAT301')).toBe('MAT301');
    expect(csvField(42)).toBe('42');
    expect(csvField(0)).toBe('0');
  });

  it('writes null and undefined as an EMPTY field, never "null" and never 0', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    // The distinction the whole system rests on survives the export:
    expect(csvField(0)).not.toBe(csvField(null));
  });

  it('quotes and escapes commas, quotes and newlines', () => {
    expect(csvField('Kumar, R.')).toBe('"Kumar, R."');
    expect(csvField('said "hi"')).toBe('"said ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('writes dates as ISO 8601 and objects as JSON', () => {
    expect(csvField(new Date('2026-07-24T09:00:00Z'))).toBe('2026-07-24T09:00:00.000Z');
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('csvRow and csvDocument', () => {
  it('joins fields and rows, with a header and a trailing newline', () => {
    expect(csvRow(['a', 1, null])).toBe('a,1,');
    expect(csvDocument(['code', 'value'], [['MAT301', 2.115], ['PHY201', null]])).toBe(
      'code,value\nMAT301,2.115\nPHY201,\n',
    );
  });
});
