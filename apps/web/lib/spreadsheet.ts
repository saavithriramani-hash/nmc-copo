import 'server-only';
import ExcelJS from 'exceljs';
import { parseDelimited } from './delimited';

/**
 * Decodes an uploaded roster/marks file into a grid of string cells.
 * Server-only (exceljs is a Node module). Excel (.xlsx) is read with
 * exceljs; .csv and anything else is read as delimited text. The pure
 * interpretation (roster.ts / marks.ts) runs on the grid afterwards.
 */
export async function decodeSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // row.eachCell skips empty cells; index into values to keep columns aligned.
      const values = row.values as (ExcelJS.CellValue | undefined)[];
      for (let col = 1; col < values.length; col += 1) {
        cells.push(cellToString(values[col]));
      }
      if (cells.some((cell) => cell !== '')) grid.push(cells);
    });
    return grid;
  }
  const text = await file.text();
  return parseDelimited(text);
}

function cellToString(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  // Rich text / hyperlink / formula cells → their displayed text.
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value && value.result != null) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
  }
  return String(value).trim();
}
