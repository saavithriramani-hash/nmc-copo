import 'server-only';
import ExcelJS from 'exceljs';
import {
  buildMarkTemplate,
  instructionLines,
  type ExistingMarks,
  type TemplateItem,
  type TemplateStudent,
} from './markTemplate';

/**
 * Turns the pure template grid into a workbook (FR-12). Server-only:
 * exceljs is a Node module.
 *
 * Sheet 1 "Marks" is what the importer reads — `decodeSpreadsheet` takes
 * worksheets[0], so nothing but the grid may live there. Guidance and the
 * question maxima go on sheet 2, where they cannot disturb parsing.
 *
 * Mark cells are left genuinely empty. Excel's own validation caps each
 * column at its item maximum, so a mis-key is caught in the spreadsheet
 * rather than at upload — though the importer still checks, because a
 * file may be edited anywhere.
 */
export async function buildMarkTemplateBuffer(args: {
  courseCode: string;
  courseTitle: string;
  assessmentName: string;
  items: TemplateItem[];
  students: TemplateStudent[];
  /** Marks already recorded, so the sheet reflects the current state. */
  existing?: ExistingMarks;
}): Promise<ArrayBuffer> {
  const { headers, rows } = buildMarkTemplate(args.items, args.students, args.existing);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CO-PO Attainment';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Marks', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });

  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 28;

  const firstDataRow = 2;
  const lastDataRow = rows.length + 1;
  args.items.forEach((item, index) => {
    const column = sheet.getColumn(index + 3);
    column.width = Math.max(8, Math.min(18, item.label.length + 4));
    column.alignment = { horizontal: 'center' };

    if (rows.length === 0) return;
    for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
      const cell = sheet.getCell(rowNumber, index + 3);
      cell.dataValidation = {
        type: 'decimal',
        operator: 'between',
        formulae: [0, item.maxMark],
        allowBlank: true, // blank ≠ zero: not attempting must stay possible
        showErrorMessage: true,
        errorStyle: 'error',
        errorTitle: 'Mark out of range',
        error: `Enter a mark between 0 and ${item.maxMark}, or leave the cell empty if the student did not attempt this question.`,
      };
    }
  });

  // Sheet 2 — never read by the importer.
  const notes = workbook.addWorksheet('Instructions');
  notes.getColumn(1).width = 78;
  const lines = instructionLines({
    courseCode: args.courseCode,
    courseTitle: args.courseTitle,
    assessmentName: args.assessmentName,
    items: args.items,
    studentCount: args.students.length,
  });
  lines.forEach((line, index) => {
    const row = notes.addRow([line]);
    if (index < 2 || /^[A-Z][A-Z .≠0-9]+$/.test(line.trim())) row.font = { bold: true };
    if (line.startsWith('LEAVE A CELL EMPTY')) row.font = { bold: true, color: { argb: 'FFB45309' } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
