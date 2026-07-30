# @copo/report

Printed reports: the course PDF (FR-19), the programme and institution
consolidations (FR-20/21), and the Procedure appendix used by the
accreditation bundle (FR-22).

## Why pdfkit and not a headless browser

PDFs are drawn with **pdfkit** and vector charts — no Chromium. A headless
browser would add roughly 300 MB to the container and a class of failures
(missing fonts, sandbox flags, `/dev/shm` sizing) that the college's
non-specialist IT staff cannot reasonably debug, which is exactly what
NFR-5 rules out. The cost is that layout is written rather than styled;
the benefit is a small image, no system packages, and charts that stay
crisp at any print resolution.

## Designed for paper

- **A4** with a wider left margin — these are hole-punched and filed.
- A **running header on every page** carrying the identifiers (course
  code and title, programme, batch), so a loose sheet can always be
  placed, and a footer with "Page x of y" plus the generation stamp,
  engine version and whether the figures are live or from a locked
  snapshot.
- **Tables that do not split badly**: every row is measured before it is
  drawn and moved whole to the next page if it will not fit, where the
  header row is repeated. Headings reserve room so they never strand at
  the foot of a page.
- Charts read in **greyscale as well as colour**: below-target bars are
  hatched, the target rule is dashed, and target-vs-achieved uses a
  filled bar against an outlined one.

## Charts

CO attainment bars (with the target rule), PO/PSO spider, target versus
achieved, and the trend across batches. All four are laid out by pure
functions in `src/charts/geometry.ts`, unit-tested against hand-computed
coordinates; the drawing layer only strokes and fills what they return.

A `null` value is never plotted as zero: bars are omitted, and the trend
line **breaks** across a batch with no figure rather than interpolating
through it — an absent number must never look like a measured one.

## Gap analysis

`analyseGaps` splits COs into met, below-target (worst shortfall first)
and **unmeasured**. A CO that was assessed nowhere is reported
separately: it is not "below target", it is unmeasured, and the report
says so. The course report prints the shortfall table with a blank
"proposed action" column and ruled lines for the faculty's action plan.

## Tests

`npm test` — 35 tests:

- **geometry** (14): bar scaling and centring, clamping, null omission,
  spider angles (first axis at 12 o'clock, clockwise) and ring radii,
  trend spacing and line breaks.
- **gap/grouping** (10): shortfall ordering, met/below/unmeasured
  separation, means that exclude nulls rather than counting them as zero,
  semester/batch filtering, department→programme nesting.
- **render** (11): every report produces a valid multi-page PDF from real
  engine output, including the awkward cases (no indirect feedback, a CO
  assessed nowhere, 180 courses forcing pagination, all-null means). Three
  of these **inflate the PDF's content streams and read the text back**,
  asserting the required sections are present and that the engine's
  hand-verified figures (2.115, 2.210, 1.889) actually appear — so a
  structurally valid but blank report cannot pass.
