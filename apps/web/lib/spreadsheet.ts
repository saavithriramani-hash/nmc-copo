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
    return sheetToGrid(sheet);
  }
  const text = await file.text();
  return parseDelimited(text);
}

/**
 * Every worksheet, keyed by name — for the course-wide mark workbook,
 * which carries one sheet per assessment.
 *
 * `decodeSpreadsheet` above deliberately reads only the first sheet, and
 * that is right for a single-assessment file whose second sheet is
 * guidance. This one exists because a course workbook's meaning is spread
 * across all of them.
 *
 * A CSV has no sheets at all. Rather than inventing one, this returns an
 * empty map for non-Excel input so the caller can say plainly that the
 * course workbook must be the .xlsx file it handed out.
 */
export async function decodeWorkbookSheets(file: File): Promise<Map<string, string[][]>> {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) return new Map();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheets = new Map<string, string[][]>();
  for (const sheet of workbook.worksheets) {
    // A later sheet of the same name cannot exist in a valid workbook,
    // but a corrupt one must not silently drop the earlier sheet's marks.
    if (sheets.has(sheet.name)) continue;
    sheets.set(sheet.name, sheetToGrid(sheet));
  }
  return sheets;
}

function sheetToGrid(sheet: ExcelJS.Worksheet): string[][] {
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
