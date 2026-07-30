import type { CourseInput, CourseResult, ParameterSource, Parameters } from '@copo/engine';

/** Display names for the engine's opaque ids, captured at export time. */
export interface ExportRefs {
  coCodeById: Record<string, string>;
  poCodeById: Record<string, string>;
  assessmentNameById: Record<string, string>;
  sectionNameById: Record<string, string>;
  itemLabelById: Record<string, string>;
}

export interface ExportCourseMeta {
  code: string;
  title: string;
  semester: number;
  departmentName: string;
  programmeName: string;
  batchName: string;
  status: string;
  /** Set when the figures come from a locked snapshot. */
  snapshotVersion: number | null;
  engineVersion: string;
  generatedAt: Date;
}

export interface ExportInput {
  course: ExportCourseMeta;
  /** The exact engine input the result was computed from. */
  input: CourseInput;
  /** The engine's output — the source of truth for every number written. */
  result: CourseResult;
  refs: ExportRefs;
  /** Which level supplied each parameter (§4); null when unknown (snapshot). */
  provenance: Record<keyof Parameters, ParameterSource> | null;
}
