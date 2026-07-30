import { describe, expect, it } from 'vitest';
import {
  gridValues,
  layoutBars,
  layoutGroupedBars,
  layoutSpider,
  layoutTrend,
  valueToY,
  type Rect,
} from '../src/charts/geometry';

/** A 300×150 plot at the origin makes the arithmetic checkable by hand. */
const plot: Rect = { x: 0, y: 0, width: 300, height: 150 };

describe('layoutBars', () => {
  it('scales heights against the maximum and centres each bar in its slot', () => {
    // 3 bars → slots of 100; barFraction 0.6 → width 60, centres 50/150/250.
    // value 3 of max 3 → full 150 high, y = 0. value 1.5 → 75 high, y = 75.
    const bars = layoutBars(
      [
        { label: 'CO1', value: 3, belowTarget: false },
        { label: 'CO2', value: 1.5, belowTarget: true },
        { label: 'CO3', value: 0, belowTarget: true },
      ],
      plot,
      3,
    );
    expect(bars[0]!.centerX).toBe(50);
    expect(bars[0]!.rect).toEqual({ x: 20, y: 0, width: 60, height: 150 });
    expect(bars[1]!.rect).toEqual({ x: 120, y: 75, width: 60, height: 75 });
    // Zero is a real value: a zero-height bar sitting on the axis.
    expect(bars[2]!.rect).toEqual({ x: 220, y: 150, width: 60, height: 0 });
  });

  it('omits the rectangle for a null value — never draws it as zero', () => {
    const bars = layoutBars([{ label: 'CO1', value: null, belowTarget: false }], plot, 3);
    expect(bars[0]!.rect).toBeNull();
    expect(bars[0]!.centerX).toBe(150);
  });

  it('clamps values outside 0..max rather than drawing off the plot', () => {
    const bars = layoutBars([{ label: 'x', value: 5, belowTarget: false }], plot, 3);
    expect(bars[0]!.rect!.height).toBe(150);
  });

  it('handles an empty series', () => {
    expect(layoutBars([], plot, 3)).toEqual([]);
  });
});

describe('valueToY and gridValues', () => {
  it('maps a value to its y coordinate (y grows downwards)', () => {
    expect(valueToY(0, plot, 3)).toBe(150);
    expect(valueToY(3, plot, 3)).toBe(0);
    expect(valueToY(2.5, plot, 3)).toBeCloseTo(25, 9); // 2.5/3 × 150 = 125 up
  });

  it('produces inclusive, evenly spaced gridlines', () => {
    expect(gridValues(3, 3)).toEqual([0, 1, 2, 3]);
    expect(gridValues(3, 6)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });
});

describe('layoutGroupedBars — target versus achieved', () => {
  it('places the group members side by side within the category slot', () => {
    // 2 categories → slots of 150; groupFraction 0.7 → group width 105,
    // 2 bars → 52.5 each. First category centre 75, group left 22.5.
    const groups = layoutGroupedBars(
      [
        { label: 'CO1', values: [{ key: 'achieved', value: 3 }, { key: 'target', value: 1.5 }] },
        { label: 'CO2', values: [{ key: 'achieved', value: null }, { key: 'target', value: 1.5 }] },
      ],
      plot,
      3,
    );
    expect(groups[0]!.centerX).toBe(75);
    expect(groups[0]!.bars[0]!.rect).toEqual({ x: 22.5, y: 0, width: 52.5, height: 150 });
    expect(groups[0]!.bars[1]!.rect).toEqual({ x: 75, y: 75, width: 52.5, height: 75 });
    // The unmeasured achievement is omitted; its target still shows.
    expect(groups[1]!.bars[0]!.rect).toBeNull();
    expect(groups[1]!.bars[1]!.rect).not.toBeNull();
  });
});

describe('layoutSpider', () => {
  const center = { x: 100, y: 100 };

  it('puts the first axis straight up and proceeds clockwise', () => {
    const spider = layoutSpider(
      [
        { label: 'PO1', value: 3 },
        { label: 'PO2', value: 3 },
        { label: 'PO3', value: 3 },
        { label: 'PO4', value: 3 },
      ],
      center,
      50,
      3,
    );
    // 4 axes at 12, 3, 6 and 9 o'clock.
    expect(spider.axes[0]!.outer.x).toBeCloseTo(100, 9);
    expect(spider.axes[0]!.outer.y).toBeCloseTo(50, 9);
    expect(spider.axes[1]!.outer.x).toBeCloseTo(150, 9);
    expect(spider.axes[1]!.outer.y).toBeCloseTo(100, 9);
    expect(spider.axes[2]!.outer.y).toBeCloseTo(150, 9);
    expect(spider.axes[3]!.outer.x).toBeCloseTo(50, 9);
  });

  it('scales each plotted point by value ÷ max', () => {
    const spider = layoutSpider([{ label: 'PO1', value: 1.5 }, { label: 'PO2', value: 0 }], center, 60, 3);
    // 1.5/3 × 60 = 30 up from the centre.
    expect(spider.axes[0]!.point).toEqual({ x: expect.closeTo(100, 9), y: expect.closeTo(70, 9) });
    // A genuine zero sits at the centre.
    expect(spider.axes[1]!.point!.y).toBeCloseTo(100, 9);
    expect(spider.partial).toBe(false);
  });

  it('marks the polygon partial and omits the point when a value is null', () => {
    const spider = layoutSpider(
      [{ label: 'PO1', value: 2 }, { label: 'PO2', value: null }, { label: 'PO3', value: 1 }],
      center,
      50,
      3,
    );
    expect(spider.axes[1]!.point).toBeNull();
    expect(spider.polygon).toHaveLength(2);
    expect(spider.partial).toBe(true);
  });

  it('draws the requested number of concentric rings', () => {
    const spider = layoutSpider([{ label: 'a', value: 1 }, { label: 'b', value: 1 }, { label: 'c', value: 1 }], center, 60, 3, 3);
    expect(spider.rings.map((ring) => ring.value)).toEqual([1, 2, 3]);
    expect(spider.rings[2]!.points).toHaveLength(3);
    // The outermost ring touches the spoke ends.
    expect(spider.rings[2]!.points[0]!.y).toBeCloseTo(40, 9);
  });
});

describe('layoutTrend across batches', () => {
  it('spreads points evenly and maps values to the scale', () => {
    const trend = layoutTrend(
      [
        { label: '2022–25', value: 0 },
        { label: '2023–26', value: 1.5 },
        { label: '2024–27', value: 3 },
      ],
      plot,
      3,
    );
    expect(trend.points.map((p) => p.point!.x)).toEqual([0, 150, 300]);
    expect(trend.points.map((p) => p.point!.y)).toEqual([150, 75, 0]);
    expect(trend.segments).toHaveLength(1);
  });

  it('breaks the line at a batch with no value instead of interpolating across it', () => {
    const trend = layoutTrend(
      [
        { label: 'a', value: 2 },
        { label: 'b', value: null },
        { label: 'c', value: 1 },
      ],
      plot,
      3,
    );
    expect(trend.points[1]!.point).toBeNull();
    expect(trend.segments).toHaveLength(2);
    expect(trend.segments[0]).toHaveLength(1);
    expect(trend.segments[1]).toHaveLength(1);
  });

  it('centres a single point', () => {
    const trend = layoutTrend([{ label: 'only', value: 3 }], plot, 3);
    expect(trend.points[0]!.point).toEqual({ x: 150, y: 0 });
  });
});
