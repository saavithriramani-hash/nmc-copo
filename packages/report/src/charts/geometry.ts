/**
 * Chart geometry — pure coordinate maths, unit-tested on its own.
 *
 * Separated from the drawing so the arithmetic that positions every bar,
 * spoke and point can be verified without producing a PDF. The drawing
 * layer does nothing but stroke and fill what these functions return.
 *
 * A value of `null` means "not computable" and is never plotted as zero:
 * bars are omitted, spider spokes fall to the centre only when a value is
 * genuinely 0, and trend lines break across a gap.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// ── bar chart ────────────────────────────────────────────────────────────

export interface BarSpec {
  label: string;
  value: number | null;
  /** Bars below target are drawn differently; the caller decides. */
  belowTarget: boolean;
}

export interface BarLayout {
  label: string;
  value: number | null;
  /** Omitted (no rectangle) when the value is null. */
  rect: Rect | null;
  /** Centre of the slot, for the axis label. */
  centerX: number;
}

/**
 * Lays out vertical bars inside `plot`, scaled 0..max. Slots are equal
 * width; each bar occupies `barFraction` of its slot, centred.
 */
export function layoutBars(bars: BarSpec[], plot: Rect, max: number, barFraction = 0.6): BarLayout[] {
  if (bars.length === 0) return [];
  const slot = plot.width / bars.length;
  const barWidth = slot * barFraction;
  return bars.map((bar, index) => {
    const centerX = plot.x + slot * index + slot / 2;
    if (bar.value === null) return { label: bar.label, value: null, rect: null, centerX };
    const clamped = Math.max(0, Math.min(max, bar.value));
    const height = (clamped / max) * plot.height;
    return {
      label: bar.label,
      value: bar.value,
      rect: { x: centerX - barWidth / 2, y: plot.y + plot.height - height, width: barWidth, height },
      centerX,
    };
  });
}

/** Y coordinate of a value on the same scale — for target lines and gridlines. */
export function valueToY(value: number, plot: Rect, max: number): number {
  const clamped = Math.max(0, Math.min(max, value));
  return plot.y + plot.height - (clamped / max) * plot.height;
}

/** Evenly spaced gridline values from 0 to max inclusive. */
export function gridValues(max: number, steps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i += 1) out.push((max / steps) * i);
  return out;
}

// ── grouped bars (target vs achieved) ────────────────────────────────────

export interface GroupedBarLayout {
  label: string;
  centerX: number;
  bars: { key: string; value: number | null; rect: Rect | null }[];
}

/** Two or more bars side by side per category. */
export function layoutGroupedBars(
  categories: { label: string; values: { key: string; value: number | null }[] }[],
  plot: Rect,
  max: number,
  groupFraction = 0.7,
): GroupedBarLayout[] {
  if (categories.length === 0) return [];
  const slot = plot.width / categories.length;
  const groupWidth = slot * groupFraction;
  return categories.map((category, index) => {
    const centerX = plot.x + slot * index + slot / 2;
    const count = Math.max(category.values.length, 1);
    const barWidth = groupWidth / count;
    const groupLeft = centerX - groupWidth / 2;
    return {
      label: category.label,
      centerX,
      bars: category.values.map((entry, barIndex) => {
        if (entry.value === null) return { key: entry.key, value: null, rect: null };
        const clamped = Math.max(0, Math.min(max, entry.value));
        const height = (clamped / max) * plot.height;
        return {
          key: entry.key,
          value: entry.value,
          rect: {
            x: groupLeft + barWidth * barIndex,
            y: plot.y + plot.height - height,
            width: barWidth,
            height,
          },
        };
      }),
    };
  });
}

// ── spider / radar ───────────────────────────────────────────────────────

export interface SpiderAxis {
  label: string;
  value: number | null;
}

export interface SpiderLayout {
  center: Point;
  radius: number;
  /** One per axis, in order, starting at 12 o'clock and going clockwise. */
  axes: {
    label: string;
    value: number | null;
    /** Outer end of the spoke, where the label sits. */
    outer: Point;
    /** Plotted point; null when the value is not computable. */
    point: Point | null;
  }[];
  /** Concentric rings at each grid value, as closed polygons. */
  rings: { value: number; points: Point[] }[];
  /** The data polygon; only the axes with values, in order. Empty if none. */
  polygon: Point[];
  /** True when some axis had no value, so the polygon is partial. */
  partial: boolean;
}

/**
 * Radar geometry. Axis i is at angle -90° + i·(360/n), i.e. the first
 * axis points straight up and they proceed clockwise — the convention
 * every accreditation spider chart uses.
 */
export function layoutSpider(axes: SpiderAxis[], center: Point, radius: number, max: number, ringCount = 3): SpiderLayout {
  const n = axes.length;
  const angleOf = (index: number): number => -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(n, 1);
  const at = (index: number, r: number): Point => ({
    x: center.x + r * Math.cos(angleOf(index)),
    y: center.y + r * Math.sin(angleOf(index)),
  });

  const laidOut = axes.map((axis, index) => {
    const value = axis.value;
    const point =
      value === null ? null : at(index, (Math.max(0, Math.min(max, value)) / max) * radius);
    return { label: axis.label, value, outer: at(index, radius), point };
  });

  const rings: SpiderLayout['rings'] = [];
  for (let ring = 1; ring <= ringCount; ring += 1) {
    const value = (max / ringCount) * ring;
    rings.push({
      value,
      points: axes.map((_, index) => at(index, (value / max) * radius)),
    });
  }

  const polygon = laidOut.filter((axis) => axis.point !== null).map((axis) => axis.point as Point);
  return {
    center,
    radius,
    axes: laidOut,
    rings,
    polygon,
    partial: polygon.length !== n,
  };
}

// ── trend across batches ─────────────────────────────────────────────────

export interface TrendPoint {
  label: string;
  value: number | null;
}

export interface TrendLayout {
  points: { label: string; value: number | null; point: Point | null }[];
  /**
   * Contiguous runs of plotted points. A batch with no value breaks the
   * line rather than being interpolated across — an absent figure must
   * never look like a measured one.
   */
  segments: Point[][];
}

export function layoutTrend(series: TrendPoint[], plot: Rect, max: number): TrendLayout {
  const n = series.length;
  const step = n <= 1 ? 0 : plot.width / (n - 1);
  const points = series.map((entry, index) => {
    const x = n === 1 ? plot.x + plot.width / 2 : plot.x + step * index;
    if (entry.value === null) return { label: entry.label, value: null, point: null };
    return { label: entry.label, value: entry.value, point: { x, y: valueToY(entry.value, plot, max) } };
  });

  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const entry of points) {
    if (entry.point === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push(entry.point);
    }
  }
  if (current.length > 0) segments.push(current);

  return { points, segments };
}
