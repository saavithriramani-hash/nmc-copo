import 'server-only';
import ExcelJS from 'exceljs';
import { COURSE_IMPORT_HEADERS, MAX_COURSE_IMPORT_ROWS, MAX_CREDITS, MAX_SEMESTER, templateInstructions } from './courseImport';

/**
 * The course import template (CR-11), built from the batches that exist
 * at download time. Server-only: exceljs is a Node module.
 *
 * Sheet 1 "Courses" is what the importer reads — `decodeSpreadsheet`
 * takes worksheets[0] — so only the header and the rows live there.
 *
 * The batch dropdown points at a range on the "Batches" sheet rather than
 * listing the labels inline: Excel caps an inline list at 255 characters,
 * which a college's worth of "Department · Programme · Batch" labels
 * passes long before its thirtieth programme. Every column the importer
 * checks is checked here too, so a mis-key is caught as it is typed —
 * though the importer still checks, because a file may be edited anywhere.
 */
export async function buildCourseImportTemplateBuffer(batchLabels: readonly string[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CO-PO Attainment';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Courses', { views: [{ state: 'frozen', ySplit: 1 }] });
  const lists = workbook.addWorksheet('Batches');
  const notes = workbook.addWorksheet('Instructions');

  sheet.addRow([...COURSE_IMPORT_HEADERS]);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  [56, 14, 36, 10, 10, 12].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  lists.addRow(['Batch']).font = { bold: true };
  for (const label of batchLabels) lists.addRow([label]);
  lists.getColumn(1).width = 60;
  const batchRange = `Batches!$A$2:$A$${Math.max(batchLabels.length + 1, 2)}`;

  const lastRow = MAX_COURSE_IMPORT_ROWS + 1;
  for (let row = 2; row <= lastRow; row += 1) {
    sheet.getCell(row, 1).dataValidation = {
      type: 'list',
      formulae: [batchRange],
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Unknown batch',
      error: 'Pick the batch from the list. For a batch created since this file was downloaded, download a fresh template.',
    };
    sheet.getCell(row, 4).dataValidation = {
      type: 'whole',
      operator: 'between',
      formulae: [1, MAX_SEMESTER],
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Semester',
      error: `Enter a whole number from 1 to ${MAX_SEMESTER}.`,
    };
    sheet.getCell(row, 5).dataValidation = {
      type: 'decimal',
      operator: 'between',
      formulae: [0, MAX_CREDITS],
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Credits',
      error: 'Enter a number of credits, or leave it empty.',
    };
    sheet.getCell(row, 6).dataValidation = {
      type: 'list',
      formulae: ['"Yes,No"'],
      allowBlank: true,
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Laboratory',
      error: 'Choose Yes for a practical paper, otherwise No.',
    };
  }

  notes.getColumn(1).width = 110;
  templateInstructions(batchLabels.length).forEach((line, index) => {
    const row = notes.addRow([line]);
    row.alignment = { wrapText: true };
    if (index === 0) row.font = { bold: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function courseImportTemplateFileName(now = new Date()): string {
  return `course-import-template-${now.toISOString().slice(0, 10)}.xlsx`;
}
