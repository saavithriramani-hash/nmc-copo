import PDFDocument from 'pdfkit';
import { COLOR, CONTENT, FONT, MARGIN, PAGE, SIZE } from './theme';

/**
 * The paper document.
 *
 * These reports are printed and filed, so this wrapper enforces the
 * things that matter on paper and are easy to get wrong:
 *
 *  - a running header on EVERY page carrying the identifiers (course
 *    code, batch, programme), so a loose sheet can always be placed;
 *  - a footer with "Page x of y" and the generation stamp;
 *  - tables that do not split badly: a row is measured before it is
 *    drawn and moved whole to the next page if it will not fit, and the
 *    header row is repeated at the top of the continuation;
 *  - headings that never strand themselves at the foot of a page.
 */

export interface RunningHead {
  /** Left of the header rule, bold — e.g. "MAT301 — Real Analysis". */
  title: string;
  /** Right of the header rule — e.g. "B.Sc. Mathematics · 2024–2027". */
  context: string;
  /** Small line under the title — e.g. "Course attainment report". */
  subtitle?: string;
}

export interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  /** Rendered smaller — for long statement columns. */
  small?: boolean;
}

export type Cell = string | { text: string; bold?: boolean; color?: string };

const cellText = (cell: Cell): string => (typeof cell === 'string' ? cell : cell.text);

export class ReportDoc {
  readonly pdf: PDFKit.PDFDocument;
  private head: RunningHead;
  private readonly footNote: string;
  private y: number;

  constructor(head: RunningHead, footNote: string) {
    this.head = head;
    this.footNote = footNote;
    this.pdf = new PDFDocument({
      size: [PAGE.width, PAGE.height],
      margins: { top: MARGIN.top, bottom: MARGIN.bottom, left: MARGIN.left, right: MARGIN.right },
      bufferPages: true,
      autoFirstPage: false,
      info: { Title: head.title, Creator: 'CO-PO Attainment System' },
    });
    this.pdf.addPage();
    this.drawHeader();
    this.y = CONTENT.top;
  }

  /** Changes the running head for subsequent pages (used by the bundle). */
  setHead(head: RunningHead): void {
    this.head = head;
  }

  get cursor(): number {
    return this.y;
  }
  set cursor(value: number) {
    this.y = value;
  }

  private drawHeader(): void {
    const pdf = this.pdf;
    pdf.save();
    pdf
      .font(FONT.bold)
      .fontSize(SIZE.subheading)
      .fillColor(COLOR.ink)
      .text(this.head.title, CONTENT.left, MARGIN.top - 46, { width: CONTENT.width * 0.62, lineBreak: false });
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.small)
      .fillColor(COLOR.muted)
      .text(this.head.context, CONTENT.left + CONTENT.width * 0.62, MARGIN.top - 44, {
        width: CONTENT.width * 0.38,
        align: 'right',
        lineBreak: false,
      });
    if (this.head.subtitle) {
      pdf
        .font(FONT.regular)
        .fontSize(SIZE.small)
        .fillColor(COLOR.muted)
        .text(this.head.subtitle, CONTENT.left, MARGIN.top - 32, { width: CONTENT.width, lineBreak: false });
    }
    pdf
      .moveTo(CONTENT.left, MARGIN.top - 18)
      .lineTo(CONTENT.right, MARGIN.top - 18)
      .lineWidth(0.75)
      .strokeColor(COLOR.rule)
      .stroke();
    pdf.restore();
  }

  /** Starts a new page and repaints the running header. */
  newPage(): void {
    this.pdf.addPage();
    this.drawHeader();
    this.y = CONTENT.top;
  }

  /** Room left on the current page. */
  get remaining(): number {
    return CONTENT.bottom - this.y;
  }

  /** Moves to a new page if `height` will not fit — the anti-orphan guard. */
  ensure(height: number): void {
    if (height > CONTENT.height) return; // taller than any page; it must flow
    if (this.remaining < height) this.newPage();
  }

  space(amount: number): void {
    this.y += amount;
  }

  title(text: string, subtitle?: string): void {
    this.ensure(48);
    this.pdf.font(FONT.bold).fontSize(SIZE.title).fillColor(COLOR.ink).text(text, CONTENT.left, this.y, { width: CONTENT.width });
    this.y = this.pdf.y + 2;
    if (subtitle) {
      this.pdf.font(FONT.regular).fontSize(SIZE.body).fillColor(COLOR.muted).text(subtitle, CONTENT.left, this.y, { width: CONTENT.width });
      this.y = this.pdf.y;
    }
    this.y += 10;
  }

  /** A section heading. Reserves room so it never strands at a page foot. */
  heading(text: string, keepWith = 60): void {
    this.ensure(18 + keepWith);
    this.pdf.font(FONT.bold).fontSize(SIZE.heading).fillColor(COLOR.ink).text(text, CONTENT.left, this.y, { width: CONTENT.width });
    this.y = this.pdf.y + 3;
    this.pdf.moveTo(CONTENT.left, this.y).lineTo(CONTENT.right, this.y).lineWidth(0.5).strokeColor(COLOR.rule).stroke();
    this.y += 7;
  }

  paragraph(text: string, options: { size?: number; color?: string; italic?: boolean } = {}): void {
    const size = options.size ?? SIZE.body;
    const font = options.italic ? FONT.italic : FONT.regular;
    const height = this.pdf.font(font).fontSize(size).heightOfString(text, { width: CONTENT.width });
    this.ensure(Math.min(height, CONTENT.height));
    this.pdf.font(font).fontSize(size).fillColor(options.color ?? COLOR.ink).text(text, CONTENT.left, this.y, { width: CONTENT.width });
    this.y = this.pdf.y + 4;
  }

  /** A label/value block for the course details panel. */
  keyValues(pairs: [string, string][], columns = 2): void {
    const columnWidth = CONTENT.width / columns;
    const rows = Math.ceil(pairs.length / columns);
    this.ensure(rows * 16 + 4);
    const startY = this.y;
    pairs.forEach((pair, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = CONTENT.left + column * columnWidth;
      const y = startY + row * 16;
      this.pdf.font(FONT.bold).fontSize(SIZE.small).fillColor(COLOR.muted).text(pair[0], x, y, { width: columnWidth - 8, lineBreak: false });
      this.pdf.font(FONT.regular).fontSize(SIZE.body).fillColor(COLOR.ink).text(pair[1], x, y + 8, { width: columnWidth - 8, lineBreak: false });
    });
    this.y = startY + rows * 16 + 6;
  }

  /**
   * Draws a table. Rows are measured first: one that will not fit moves
   * whole to the next page, where the header row is repeated — a row is
   * never sliced across the fold.
   */
  table(columns: Column[], rows: Cell[][], options: { zebra?: boolean; fontSize?: number } = {}): void {
    const fontSize = options.fontSize ?? SIZE.table;
    const padding = 3.5;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const scale = totalWidth > CONTENT.width ? CONTENT.width / totalWidth : 1;
    const widths = columns.map((column) => column.width * scale);

    const measure = (cells: Cell[]): number => {
      let tallest = fontSize * 1.2;
      cells.forEach((cell, index) => {
        const width = (widths[index] ?? 40) - padding * 2;
        const size = columns[index]?.small ? fontSize - 0.7 : fontSize;
        const height = this.pdf.font(FONT.regular).fontSize(size).heightOfString(cellText(cell), { width });
        if (height > tallest) tallest = height;
      });
      return tallest + padding * 2;
    };

    const headerHeight = measure(columns.map((column) => column.header));

    const drawHeaderRow = (): void => {
      let x = CONTENT.left;
      this.pdf.rect(CONTENT.left, this.y, widths.reduce((a, b) => a + b, 0), headerHeight).fillColor(COLOR.headerFill).fill();
      columns.forEach((column, index) => {
        const width = widths[index]!;
        this.pdf
          .font(FONT.bold)
          .fontSize(column.small ? fontSize - 0.7 : fontSize)
          .fillColor(COLOR.ink)
          .text(column.header, x + padding, this.y + padding, { width: width - padding * 2, align: column.align ?? 'left' });
        x += width;
      });
      this.strokeRow(widths, this.y, headerHeight);
      this.y += headerHeight;
    };

    this.ensure(headerHeight + Math.min(measure(rows[0] ?? []), 60));
    drawHeaderRow();

    rows.forEach((cells, rowIndex) => {
      const height = measure(cells);
      if (this.remaining < height) {
        this.newPage();
        drawHeaderRow();
      }
      if (options.zebra !== false && rowIndex % 2 === 1) {
        this.pdf.rect(CONTENT.left, this.y, widths.reduce((a, b) => a + b, 0), height).fillColor(COLOR.zebra).fill();
      }
      let x = CONTENT.left;
      cells.forEach((cell, index) => {
        const width = widths[index] ?? 40;
        const column = columns[index];
        const bold = typeof cell === 'object' && cell.bold === true;
        const color = typeof cell === 'object' && cell.color ? cell.color : COLOR.ink;
        this.pdf
          .font(bold ? FONT.bold : FONT.regular)
          .fontSize(column?.small ? fontSize - 0.7 : fontSize)
          .fillColor(color)
          .text(cellText(cell), x + padding, this.y + padding, { width: width - padding * 2, align: column?.align ?? 'left' });
        x += width;
      });
      this.strokeRow(widths, this.y, height);
      this.y += height;
    });

    this.y += 8;
  }

  private strokeRow(widths: number[], top: number, height: number): void {
    const total = widths.reduce((a, b) => a + b, 0);
    this.pdf.lineWidth(0.4).strokeColor(COLOR.rule);
    this.pdf.rect(CONTENT.left, top, total, height).stroke();
    let x = CONTENT.left;
    for (const width of widths.slice(0, -1)) {
      x += width;
      this.pdf.moveTo(x, top).lineTo(x, top + height).stroke();
    }
  }

  /** Ruled blank lines for a handwritten action plan. */
  ruledLines(count: number, lineHeight = 16): void {
    this.ensure(count * lineHeight + 4);
    for (let i = 0; i < count; i += 1) {
      const y = this.y + lineHeight * (i + 1) - 4;
      this.pdf.moveTo(CONTENT.left, y).lineTo(CONTENT.right, y).lineWidth(0.4).strokeColor(COLOR.gridline).stroke();
    }
    this.y += count * lineHeight + 6;
  }

  /** Signature blocks at the foot of a report. */
  signatures(labels: string[]): void {
    this.ensure(56);
    const width = CONTENT.width / labels.length;
    const y = this.y + 30;
    labels.forEach((label, index) => {
      const x = CONTENT.left + width * index;
      this.pdf.moveTo(x, y).lineTo(x + width - 24, y).lineWidth(0.5).strokeColor(COLOR.ink).stroke();
      this.pdf.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.muted).text(label, x, y + 4, { width: width - 24 });
    });
    this.y = y + 20;
  }

  /**
   * Stamps the footer on every page and finishes the document. Page
   * numbers are written last, when the total is finally known.
   */
  async finish(): Promise<Buffer> {
    const range = this.pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      this.pdf.switchToPage(range.start + i);
      const y = PAGE.height - MARGIN.bottom + 18;
      this.pdf.moveTo(CONTENT.left, y - 8).lineTo(CONTENT.right, y - 8).lineWidth(0.5).strokeColor(COLOR.rule).stroke();
      this.pdf.font(FONT.regular).fontSize(SIZE.tiny).fillColor(COLOR.faint);
      this.pdf.text(this.footNote, CONTENT.left, y, { width: CONTENT.width * 0.7, lineBreak: false });
      this.pdf.text(`Page ${i + 1} of ${range.count}`, CONTENT.left + CONTENT.width * 0.7, y, {
        width: CONTENT.width * 0.3,
        align: 'right',
        lineBreak: false,
      });
    }

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      this.pdf.on('end', () => resolve(Buffer.concat(chunks)));
      this.pdf.on('error', reject);
      this.pdf.end();
    });
  }
}
