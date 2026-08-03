import 'server-only';
import ExcelJS from 'exceljs';
import { INSTRUCTIONS_SHEET, courseInstructionLines } from './courseWorkbook';
import { buildMarkTemplate, type ExistingMarks, type TemplateItem, type TemplateStudent } from './markTemplate';

/**
 * The course-wide mark workbook (FR-12), one sheet per assessment.
 * Server-only: exceljs is a Node module.
 *
 * Each mark sheet is exactly what the single-assessment template
 * produces — same headers, same pre-filled marks, same per-item Excel
 * validation — because the importer reads both with `planMarkImport`.
 * Nothing decorative may sit in a header row: the maxima and the
 * guidance live on the Instructions sheet.
 *
 * Instructions comes FIRST so Excel opens on it and the reader is told
 * the blank ≠ zero rule before touching anything. The importer skips it
 * by name.
 */
export interface CourseWorkbookSheet {
  sheetName: string;
  assessmentName: string;
  items: TemplateItem[];
}

export async function buildCourseWorkbookBuffer(args: {
  courseCode: string;
  courseTitle: string;
  students: TemplateStudent[];
  sheets: CourseWorkbookSheet[];
  /** Marks already recorded, keyed `${registerNumber}|${itemId}`, course-wide. */
  existing?: ExistingMarks;
}): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CO-PO Attainment';
  workbook.created = new Date();

  const notes = workbook.addWorksheet(INSTRUCTIONS_SHEET);
  notes.getColumn(1).width = 78;
  const lines = courseInstructionLines({
    courseCode: args.courseCode,
    courseTitle: args.courseTitle,
    studentCount: args.students.length,
    assessments: args.sheets.map((sheet) => ({
      name: sheet.assessmentName,
      sheetName: sheet.sheetName,
      items: sheet.items.map((item) => ({ id: item.id, label: item.label, maxMark: item.maxMark })),
    })),
  });
  lines.forEach((line, index) => {
    const row = notes.addRow([line]);
    if (index < 2 || /^[A-Z][A-Z .≠0-9]+$/.test(line.trim())) row.font = { bold: true };
    if (line.startsWith('LEAVE A CELL EMPTY') || line.startsWith('THE MARKS ALREADY RECORDED')) {
      row.font = { bold: true, color: { argb: 'FFB45309' } };
    }
  });

  for (const spec of args.sheets) {
    const { headers, rows } = buildMarkTemplate(spec.items, args.students, args.existing);
    const sheet = workbook.addWorksheet(spec.sheetName, {
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
    spec.items.forEach((item, index) => {
      const column = sheet.getColumn(index + 3);
      column.width = Math.max(8, Math.min(18, item.label.length + 4));
      column.alignment = { horizontal: 'center' };

      if (rows.length === 0) return;
      for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
        sheet.getCell(rowNumber, index + 3).dataValidation = {
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
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
