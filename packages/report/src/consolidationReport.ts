import { drawSpider, drawTrend } from './charts/draw';
import { ReportDoc, type Cell, type Column } from './doc';
import { groupByDepartment, meanByPo, semestersPresent, type CourseRow, type MeanCell } from './grouping';
import { COLOR, CONTENT, SIZE } from './theme';
import type { ConsolidationReportData } from './types';

const fmt = (value: number | null | undefined, dp = 3): string =>
  value === null || value === undefined ? '—' : value.toFixed(dp);

function scopeLine(data: ConsolidationReportData): string {
  const parts: string[] = [];
  if (data.meta.filter.semester !== undefined) parts.push(`Semester ${data.meta.filter.semester}`);
  if (data.meta.filter.batchName !== undefined) parts.push(`Batch ${data.meta.filter.batchName}`);
  return parts.length > 0 ? parts.join(' · ') : 'All semesters and batches';
}

/** Column layout shared by every consolidation table. */
function poColumns(poCodes: string[], firstHeader: string, firstWidth: number): Column[] {
  return [
    { header: firstHeader, width: firstWidth },
    { header: 'Sem', width: 28, align: 'center' },
    ...poCodes.map((code) => ({ header: code, width: 36, align: 'right' as const })),
  ];
}

function courseRowCells(row: CourseRow, poCodes: string[]): Cell[] {
  return [
    { text: `${row.code} — ${row.title}`, bold: false },
    String(row.semester),
    ...poCodes.map((code) => {
      const value = row.po[code];
      if (row.error) return { text: '!', color: COLOR.barBelow };
      return value === null || value === undefined ? { text: '—', color: COLOR.faint } : fmt(value, 2);
    }),
  ];
}

function meanRowCells(label: string, means: Record<string, MeanCell>, poCodes: string[]): Cell[] {
  return [
    { text: label, bold: true },
    '',
    ...poCodes.map((code) => ({ text: fmt(means[code]?.mean ?? null, 2), bold: true })),
  ];
}

/**
 * Programme consolidation (FR-20): PO/PSO attainment across every course
 * of a programme, optionally narrowed to one semester or one batch.
 */
export async function renderProgrammeConsolidation(data: ConsolidationReportData): Promise<Buffer> {
  const doc = new ReportDoc(
    {
      title: data.meta.scopeLabel,
      context: scopeLine(data),
      subtitle: 'Programme consolidation — PO/PSO attainment',
    },
    `Generated ${data.meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${data.meta.engineVersion}`,
  );

  doc.title('Programme Consolidation', `${data.meta.scopeLabel} · ${data.meta.scopeContext}`);
  doc.paragraph(`${data.rows.length} course(s). ${scopeLine(data)}.`);

  const means = meanByPo(data.rows, data.poCodes);

  doc.heading('1. PO / PSO attainment by course');
  const rows: Cell[][] = data.rows.map((row) => courseRowCells(row, data.poCodes));
  rows.push(meanRowCells('Mean across courses', means, data.poCodes));
  doc.table(poColumns(data.poCodes, 'Course', 200), rows);
  doc.paragraph(
    'Each cell is that course’s official PO figure (Procedure Step 10). The mean is a plain arithmetic mean over the ' +
      'courses that produced a value; a course with no computable figure is excluded, never counted as zero. The ' +
      'Procedure defines no cross-course formula, so nothing further is inferred here.',
    { size: SIZE.small, color: COLOR.muted, italic: true },
  );
  const counts = data.poCodes.map((code) => `${code}: ${means[code]?.n ?? 0}`).join(' · ');
  doc.paragraph(`Courses contributing to each mean — ${counts}`, { size: SIZE.small, color: COLOR.muted });

  // Spider of the programme means.
  doc.heading('2. Attainment profile', 230);
  doc.ensure(225);
  const centerY = doc.cursor + 100;
  drawSpider(
    doc.pdf,
    { x: CONTENT.left + CONTENT.width / 2, y: centerY },
    80,
    data.poCodes.map((code) => ({ label: code, value: means[code]?.mean ?? null })),
    3,
  );
  doc.space(210);

  // Trend across batches, when there is more than one.
  if (data.trend && data.trend.length > 1) {
    doc.heading('3. Trend across batches', 190);
    doc.ensure(180);
    drawTrend(
      doc.pdf,
      { x: CONTENT.left + 28, y: doc.cursor + 6, width: CONTENT.width - 60, height: 120 },
      data.trend.map((entry) => ({ label: entry.batchName, value: entry.meanPo })),
      3,
    );
    doc.space(170);
    doc.paragraph('Mean PO/PSO attainment across all courses of each batch, oldest first.', {
      size: SIZE.small,
      color: COLOR.muted,
      italic: true,
    });
  }

  if (data.poStatements.length > 0) {
    doc.heading('Appendix — PO / PSO statements');
    doc.table(
      [
        { header: 'Code', width: 50 },
        { header: 'Statement', width: 420, small: true },
      ],
      data.poStatements.map((entry) => [{ text: entry.code, bold: true }, entry.statement]),
    );
  }

  const failed = data.rows.filter((row) => row.error);
  if (failed.length > 0) {
    doc.heading('Courses that could not be computed');
    doc.table(
      [
        { header: 'Course', width: 160 },
        { header: 'Reason', width: 310, small: true },
      ],
      failed.map((row) => [{ text: row.code, bold: true }, row.error ?? '']),
    );
  }

  doc.space(6);
  doc.signatures(['Programme coordinator', 'Head of the Department', 'IQAC']);
  return doc.finish();
}

/**
 * Institution consolidation for the IQAC (FR-21), broken down by
 * department and then by programme.
 */
export async function renderInstitutionConsolidation(data: ConsolidationReportData): Promise<Buffer> {
  const doc = new ReportDoc(
    {
      title: data.meta.scopeLabel,
      context: scopeLine(data),
      subtitle: 'Institution consolidation — PO/PSO attainment by department',
    },
    `Generated ${data.meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${data.meta.engineVersion}`,
  );

  doc.title('Institution Consolidation', data.meta.scopeLabel);
  const departments = groupByDepartment(data.rows, data.poCodes);
  doc.paragraph(
    `${data.rows.length} course(s) across ${departments.length} department(s) and ` +
      `${departments.reduce((sum, dept) => sum + dept.programmes.length, 0)} programme(s). ${scopeLine(data)}.`,
  );
  doc.paragraph(
    `Semesters present: ${semestersPresent(data.rows).join(', ') || '—'}.`,
    { size: SIZE.small, color: COLOR.muted },
  );

  // Institution-wide summary first — the IQAC reads this line.
  doc.heading('1. Institution summary');
  const overall = meanByPo(data.rows, data.poCodes);
  doc.table(
    [
      { header: 'Scope', width: 200 },
      { header: 'Courses', width: 50, align: 'center' },
      ...data.poCodes.map((code) => ({ header: code, width: 36, align: 'right' as const })),
    ],
    [
      [
        { text: 'All departments', bold: true },
        String(data.rows.length),
        ...data.poCodes.map((code) => ({ text: fmt(overall[code]?.mean ?? null, 2), bold: true })),
      ],
      ...departments.map((department) => [
        department.departmentName,
        String(department.rows.length),
        ...data.poCodes.map((code) => fmt(department.means[code]?.mean ?? null, 2)),
      ]),
    ],
  );
  doc.paragraph(
    'PO/PSO codes are shared across programmes only where a programme defines that code; a programme without it ' +
      'contributes nothing to that column rather than a zero.',
    { size: SIZE.small, color: COLOR.muted, italic: true },
  );

  // Then department by department, programme by programme.
  let sectionNumber = 2;
  for (const department of departments) {
    doc.heading(`${sectionNumber}. ${department.departmentName}`, 120);
    sectionNumber += 1;
    for (const programme of department.programmes) {
      doc.paragraph(programme.programmeName, { size: SIZE.subheading });
      const rows: Cell[][] = programme.rows.map((row) => courseRowCells(row, data.poCodes));
      rows.push(meanRowCells('Programme mean', programme.means, data.poCodes));
      doc.table(poColumns(data.poCodes, 'Course', 200), rows);
    }
    doc.table(
      [
        { header: 'Department mean', width: 200 },
        { header: '', width: 28 },
        ...data.poCodes.map((code) => ({ header: code, width: 36, align: 'right' as const })),
      ],
      [meanRowCells(department.departmentName, department.means, data.poCodes)],
      { zebra: false },
    );
  }

  doc.space(6);
  doc.signatures(['IQAC Coordinator', 'Principal']);
  return doc.finish();
}
