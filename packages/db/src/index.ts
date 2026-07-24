/**
 * @copo/db — persistence layer for the CO-PO attainment application.
 *
 * Owns the Prisma schema/migrations, the dev seed, and the adapter that
 * turns database rows into the engine's CourseInput. Depends on
 * @copo/engine; the engine never depends on this package.
 */

export { PrismaClient, Prisma } from '@prisma/client';
export { createPrismaClient, loadDotEnv } from './client';
export { AdapterError } from './errors';
export { institutionParameters, parameterOverrides } from './parameters';
export {
  buildCourseInput,
  loadCourseInput,
  courseInputArgs,
  type CourseForInput,
  type CourseLoadResult,
  type MarkRow,
} from './adapter';
export { assessmentMarkSummary, type ItemMarkSummary } from './queries';
