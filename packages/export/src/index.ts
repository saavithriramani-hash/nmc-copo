/**
 * @copo/export — the departmental Excel workbook for one course.
 *
 * Live formulas so a reader can see the arithmetic in the cells; the
 * numbers are the engine's. The round-trip test in tests/ opens a
 * generated file, evaluates its formulas independently of the cached
 * values, and asserts they agree with the engine — a divergence is a bug
 * in this package, never in the engine.
 */
export { buildWorkbook, buildWorkbookWithIndex, buildWorkbookBuffer, exportFileName, SHEET } from './workbook';
export type { WorkbookIndex } from './workbook';
export type { ExportInput, ExportCourseMeta, ExportRefs } from './types';

/**
 * The learning outcome workbook (CR-7) — a separate document from the
 * departmental workbook above, and separately built: it reports the
 * knowledge levels a paper examines, which is no part of the ten steps.
 */
export { buildLearningOutcomeWorkbook, type LearningOutcomeInput } from './learningOutcome';

/**
 * The slow and advanced learner workbook (CR-8, NAAC 2.2.1) — likewise a
 * separate document, laid out as the college's own: a sheet per subject
 * and a semester sheet averaging across them.
 */
export { buildLearnerCategoryWorkbook, type LearnerWorkbookInput } from './learnerCategories';
