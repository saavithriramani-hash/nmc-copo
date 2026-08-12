/**
 * @copo/report — printed reports, designed for paper.
 *
 * PDFs are produced with pdfkit and vector charts: no headless browser,
 * so the deployed container stays small and there is nothing extra for
 * the college's IT staff to install or debug (NFR-5). The course report
 * is also produced as a Word document, on the same principle — `docx`
 * writes the OOXML directly, with no Word installation anywhere near the
 * server. Both read the same `CourseReportData` and format their figures
 * through the same helpers, so the two can never state a number
 * differently.
 *
 * Every page carries a running header with the identifiers, a footer
 * with "page x of y", and tables that move a row whole to the next page
 * rather than splitting it across the fold.
 */
export { renderCourseReport } from './courseReport';
export { renderCourseReportDocx } from './courseReportDocx';
export { fmt, pct } from './format';
export { renderProgrammeConsolidation, renderInstitutionConsolidation } from './consolidationReport';
export { renderAppendix } from './appendix';
export {
  renderAccountSlips,
  type AccountSlip,
  type AccountSlipsData,
  type RejectedRow,
  type SkippedRow,
} from './accountSlips';
export { ReportDoc } from './doc';
export { analyseGaps, type GapAnalysis, type GapRow } from './gap';
export {
  applyFilter,
  groupByDepartment,
  meanByPo,
  semestersPresent,
  type CourseRow,
  type DepartmentGroup,
  type MeanCell,
} from './grouping';
export * from './charts/geometry';
export type {
  AppendixData,
  ConsolidationMeta,
  ConsolidationReportData,
  CourseMeta,
  CourseReportData,
  ReportRefs,
} from './types';
