import { COLOR, FONT, SIZE } from '../theme';
import {
  gridValues,
  layoutBars,
  layoutGroupedBars,
  layoutSpider,
  layoutTrend,
  valueToY,
  type Rect,
  type SpiderAxis,
  type TrendPoint,
} from './geometry';

/**
 * Chart drawing. Every coordinate comes from the tested geometry in
 * ./geometry — this file only strokes and fills.
 *
 * Charts are vector, not raster, so they stay crisp at any print
 * resolution, and each is designed to read in greyscale: below-target
 * bars are hatched as well as tinted, and the target line is dashed.
 */

type Pdf = PDFKit.PDFDocument;

function axisFrame(pdf: Pdf, plot: Rect, max: number, steps: number): void {
  for (const value of gridValues(max, steps)) {
    const y = valueToY(value, plot, max);
    pdf
      .moveTo(plot.x, y)
      .lineTo(plot.x + plot.width, y)
      .lineWidth(value === 0 ? 0.8 : 0.4)
      .strokeColor(value === 0 ? COLOR.ink : COLOR.gridline)
      .stroke();
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.faint)
      .text(value.toFixed(value % 1 === 0 ? 0 : 1), plot.x - 20, y - 3, { width: 16, align: 'right', lineBreak: false });
  }
  pdf.moveTo(plot.x, plot.y).lineTo(plot.x, plot.y + plot.height).lineWidth(0.8).strokeColor(COLOR.ink).stroke();
}

/** Diagonal hatching, so a below-target bar is distinguishable in greyscale. */
function hatch(pdf: Pdf, rect: Rect): void {
  if (rect.height <= 0) return;
  pdf.save();
  pdf.rect(rect.x, rect.y, rect.width, rect.height).clip();
  pdf.lineWidth(0.5).strokeColor('#ffffff');
  for (let offset = -rect.height; offset < rect.width; offset += 4) {
    pdf
      .moveTo(rect.x + offset, rect.y + rect.height)
      .lineTo(rect.x + offset + rect.height, rect.y)
      .stroke();
  }
  pdf.restore();
}

/** CO attainment bars, with the target drawn as a dashed rule across them. */
export function drawCoBars(
  pdf: Pdf,
  plot: Rect,
  data: { label: string; value: number | null }[],
  options: { max?: number; target?: number | null; caption?: string } = {},
): void {
  const max = options.max ?? 3;
  axisFrame(pdf, plot, max, 3);

  const bars = layoutBars(
    data.map((entry) => ({
      label: entry.label,
      value: entry.value,
      belowTarget: options.target != null && entry.value !== null && entry.value < options.target,
    })),
    plot,
    max,
  );

  bars.forEach((bar, index) => {
    const belowTarget = options.target != null && bar.value !== null && bar.value < options.target;
    if (bar.rect && bar.rect.height > 0) {
      pdf.rect(bar.rect.x, bar.rect.y, bar.rect.width, bar.rect.height).fillColor(belowTarget ? COLOR.barBelow : COLOR.bar).fill();
      if (belowTarget) hatch(pdf, bar.rect);
    }
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.muted)
      .text(bar.label, bar.centerX - 24, plot.y + plot.height + 4, { width: 48, align: 'center', lineBreak: false });
    // The figure itself, above the bar — an auditor reads numbers, not pixels.
    const text = bar.value === null ? 'n/a' : bar.value.toFixed(2);
    const top = bar.rect ? bar.rect.y : plot.y + plot.height;
    pdf
      .font(FONT.bold)
      .fontSize(SIZE.tiny)
      .fillColor(bar.value === null ? COLOR.faint : COLOR.ink)
      .text(text, bar.centerX - 24, top - 9, { width: 48, align: 'center', lineBreak: false });
    void index;
  });

  if (options.target != null) {
    const y = valueToY(options.target, plot, max);
    pdf
      .save()
      .dash(3, { space: 2 })
      .moveTo(plot.x, y)
      .lineTo(plot.x + plot.width, y)
      .lineWidth(0.9)
      .strokeColor(COLOR.target)
      .stroke()
      .undash()
      .restore();
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.target)
      .text(`target ${options.target}`, plot.x + plot.width + 3, y - 3, { width: 46, lineBreak: false });
  }

  if (options.caption) {
    pdf
      .font(FONT.italic)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.faint)
      .text(options.caption, plot.x, plot.y + plot.height + 16, { width: plot.width });
  }
}

/** Target versus achieved, as paired bars per CO. */
export function drawTargetVsAchieved(
  pdf: Pdf,
  plot: Rect,
  data: { label: string; achieved: number | null; target: number }[],
  max = 3,
): void {
  axisFrame(pdf, plot, max, 3);
  const groups = layoutGroupedBars(
    data.map((entry) => ({
      label: entry.label,
      values: [
        { key: 'achieved', value: entry.achieved },
        { key: 'target', value: entry.target },
      ],
    })),
    plot,
    max,
  );

  groups.forEach((group) => {
    group.bars.forEach((bar) => {
      if (!bar.rect || bar.rect.height <= 0) return;
      if (bar.key === 'achieved') {
        pdf.rect(bar.rect.x, bar.rect.y, bar.rect.width, bar.rect.height).fillColor(COLOR.bar).fill();
      } else {
        // The target is an outline, so the achieved bar reads as the fact.
        pdf.rect(bar.rect.x, bar.rect.y, bar.rect.width, bar.rect.height).lineWidth(0.7).strokeColor(COLOR.target).stroke();
      }
    });
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.muted)
      .text(group.label, group.centerX - 24, plot.y + plot.height + 4, { width: 48, align: 'center', lineBreak: false });
  });

  legend(pdf, plot.x, plot.y + plot.height + 16, [
    { label: 'achieved', swatch: 'fill' },
    { label: 'target', swatch: 'outline' },
  ]);
}

/** PO/PSO spider. */
export function drawSpider(pdf: Pdf, center: { x: number; y: number }, radius: number, axes: SpiderAxis[], max = 3): void {
  const spider = layoutSpider(axes, center, radius, max, 3);

  for (const ring of spider.rings) {
    pdf.save().lineWidth(0.4).strokeColor(COLOR.gridline);
    ring.points.forEach((point, index) => (index === 0 ? pdf.moveTo(point.x, point.y) : pdf.lineTo(point.x, point.y)));
    pdf.closePath().stroke().restore();
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.faint)
      .text(ring.value.toFixed(0), center.x + 2, center.y - (ring.value / max) * radius - 3, { width: 14, lineBreak: false });
  }

  for (const axis of spider.axes) {
    pdf.moveTo(center.x, center.y).lineTo(axis.outer.x, axis.outer.y).lineWidth(0.4).strokeColor(COLOR.gridline).stroke();
    const labelX = axis.outer.x + (axis.outer.x - center.x) * 0.12 - 20;
    const labelY = axis.outer.y + (axis.outer.y - center.y) * 0.12 - 4;
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.muted)
      .text(axis.label, labelX, labelY, { width: 40, align: 'center', lineBreak: false });
  }

  if (spider.polygon.length >= 3) {
    pdf.save().fillOpacity(0.18).fillColor(COLOR.spiderFill);
    spider.polygon.forEach((point, index) => (index === 0 ? pdf.moveTo(point.x, point.y) : pdf.lineTo(point.x, point.y)));
    pdf.closePath().fill().restore();
    pdf.save().lineWidth(1.1).strokeColor(COLOR.bar);
    spider.polygon.forEach((point, index) => (index === 0 ? pdf.moveTo(point.x, point.y) : pdf.lineTo(point.x, point.y)));
    pdf.closePath().stroke().restore();
  }

  for (const axis of spider.axes) {
    if (!axis.point) continue;
    pdf.circle(axis.point.x, axis.point.y, 1.8).fillColor(COLOR.bar).fill();
  }

  if (spider.partial) {
    pdf
      .font(FONT.italic)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.faint)
      .text('Dotted outline is partial: one or more PO/PSOs could not be computed.', center.x - radius, center.y + radius + 18, {
        width: radius * 2,
        align: 'center',
      });
  }
}

/** Attainment trend across batches. */
export function drawTrend(pdf: Pdf, plot: Rect, series: TrendPoint[], max = 3): void {
  axisFrame(pdf, plot, max, 3);
  const trend = layoutTrend(series, plot, max);

  for (const segment of trend.segments) {
    if (segment.length === 1) {
      pdf.circle(segment[0]!.x, segment[0]!.y, 2.4).fillColor(COLOR.bar).fill();
      continue;
    }
    pdf.save().lineWidth(1.3).strokeColor(COLOR.bar);
    segment.forEach((point, index) => (index === 0 ? pdf.moveTo(point.x, point.y) : pdf.lineTo(point.x, point.y)));
    pdf.stroke().restore();
  }

  trend.points.forEach((entry) => {
    if (entry.point) {
      pdf.circle(entry.point.x, entry.point.y, 2.2).fillColor(COLOR.bar).fill();
      pdf
        .font(FONT.bold)
        .fontSize(SIZE.tiny)
        .fillColor(COLOR.ink)
        .text(entry.value!.toFixed(2), entry.point.x - 20, entry.point.y - 11, { width: 40, align: 'center', lineBreak: false });
    }
    const x = entry.point ? entry.point.x : plot.x;
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.muted)
      .text(entry.label, x - 30, plot.y + plot.height + 4, { width: 60, align: 'center', lineBreak: false });
  });

  if (trend.segments.length > 1) {
    pdf
      .font(FONT.italic)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.faint)
      .text('The line breaks where a batch has no computable figure — it is not interpolated.', plot.x, plot.y + plot.height + 16, {
        width: plot.width,
      });
  }
}

function legend(pdf: Pdf, x: number, y: number, entries: { label: string; swatch: 'fill' | 'outline' }[]): void {
  let cursor = x;
  for (const entry of entries) {
    if (entry.swatch === 'fill') pdf.rect(cursor, y, 8, 8).fillColor(COLOR.bar).fill();
    else pdf.rect(cursor, y, 8, 8).lineWidth(0.7).strokeColor(COLOR.target).stroke();
    pdf
      .font(FONT.regular)
      .fontSize(SIZE.tiny)
      .fillColor(COLOR.muted)
      .text(entry.label, cursor + 11, y + 1, { width: 60, lineBreak: false });
    cursor += 11 + 60;
  }
}
