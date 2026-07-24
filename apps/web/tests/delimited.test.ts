import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseDelimited } from '../lib/delimited';

describe('detectDelimiter', () => {
  it('picks tab for spreadsheet paste and comma for CSV', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
});

describe('parseDelimited', () => {
  it('parses a simple CSV grid and trims cells', () => {
    expect(parseDelimited('reg, name\n24MAT001 , Anita ')).toEqual([
      ['reg', 'name'],
      ['24MAT001', 'Anita'],
    ]);
  });

  it('parses TSV (clipboard paste)', () => {
    expect(parseDelimited('Reg\tQ1\tQ2\n24MAT001\t5\t\t')).toEqual([['Reg', 'Q1', 'Q2'], ['24MAT001', '5', '', '']]);
  });

  it('honours quoted fields with embedded commas, quotes and newlines', () => {
    const text = '"Kumar, R.","said ""hi""","line1\nline2"';
    expect(parseDelimited(text, ',')).toEqual([['Kumar, R.', 'said "hi"', 'line1\nline2']]);
  });

  it('drops wholly blank lines but keeps empty cells inside a row', () => {
    expect(parseDelimited('a,b\n\n,\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // a row of two empty cells is blank → dropped
    expect(parseDelimited('a,b\n ,\n')).toEqual([['a', 'b']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
