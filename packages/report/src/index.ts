/**
 * @copo/report — printed reports, designed for paper.
 *
 * PDFs are produced with pdfkit and vector charts: no headless browser,
 * so the deployed container stays small and there is nothing extra for
 * the college's IT staff to install or debug (NFR-5).
 *
 * Every page carries a running header with the identifiers, a footer
 * with "page x of y", and tables that move a row whole to the next page
 * rather than splitting it across the fold.
 */
export { renderCourseReport } from './courseReport';
export { renderProgrammeConsolidation, renderInstitutionConsolidation } from './consolidationReport';
export { renderAppendix } from './appendix';
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
