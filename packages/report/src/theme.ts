/**
 * Paper geometry and styling. These reports are printed and filed, so
 * every dimension is chosen for A4 with a binding-friendly left margin,
 * and a reserved band at the top and bottom of every page for the
 * running header (course/batch identifiers) and footer (page x of y).
 */

/** A4 in PDF points (72 per inch). */
export const PAGE = {
  width: 595.28,
  height: 841.89,
} as const;

export const MARGIN = {
  /** Wider on the left: reports are hole-punched and filed. */
  left: 56,
  right: 40,
  /** Space above the body for the running header. */
  top: 74,
  /** Space below the body for the footer. */
  bottom: 56,
} as const;

export const CONTENT = {
  left: MARGIN.left,
  right: PAGE.width - MARGIN.right,
  top: MARGIN.top,
  bottom: PAGE.height - MARGIN.bottom,
  get width(): number {
    return PAGE.width - MARGIN.left - MARGIN.right;
  },
  get height(): number {
    return PAGE.height - MARGIN.top - MARGIN.bottom;
  },
} as const;

export const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
} as const;

export const SIZE = {
  title: 16,
  heading: 11.5,
  subheading: 10,
  body: 9,
  table: 8.5,
  small: 7.5,
  tiny: 6.8,
} as const;

export const COLOR = {
  ink: '#111111',
  muted: '#5b5b5b',
  faint: '#8a8a8a',
  rule: '#bfbfbf',
  headerFill: '#e9e9e9',
  zebra: '#f6f6f6',
  /** Print-safe accents: distinguishable in greyscale as well as colour. */
  bar: '#3f6fb5',
  barBelow: '#b5563f',
  target: '#7a7a7a',
  gridline: '#d5d5d5',
  spiderFill: '#3f6fb5',
} as const;

export const LEADING = 1.25;
