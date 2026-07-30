import type { CourseInput, CourseResult, ParameterSource, Parameters } from '@copo/engine';
import type { CourseRow } from './grouping';

export interface ReportRefs {
  coCodeById: Record<string, string>;
  poCodeById: Record<string, string>;
  assessmentNameById: Record<string, string>;
  sectionNameById: Record<string, string>;
  itemLabelById: Record<string, string>;
}

export interface CourseMeta {
  code: string;
  title: string;
  semester: number;
  credits: string | null;
  departmentName: string;
  programmeName: string;
  batchName: string;
  status: string;
  facultyNames: string[];
  enrolmentCount: number;
  snapshotVersion: number | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  engineVersion: string;
  generatedAt: Date;
}

export interface CourseReportData {
  course: CourseMeta;
  /** CO statements, in display order. */
  cos: { id: string; code: string; statement: string; bloomLevels: string[] }[];
  /** PO/PSO statements for the programme. */
  pos: { id: string; code: string; kind: 'PO' | 'PSO'; statement: string }[];
  input: CourseInput;
  result: CourseResult;
  refs: ReportRefs;
  provenance: Record<keyof Parameters, ParameterSource> | null;
}

export interface ConsolidationMeta {
  /** e.g. "B.Sc. Mathematics" or "Nehru Memorial College (Autonomous)". */
  scopeLabel: string;
  /** e.g. "Mathematics" or "All departments". */
  scopeContext: string;
  filter: { semester?: number; batchName?: string };
  generatedAt: Date;
  engineVersion: string;
}

export interface ConsolidationReportData {
  meta: ConsolidationMeta;
  poCodes: string[];
  /** PO/PSO statements, where known, for the legend. */
  poStatements: { code: string; statement: string }[];
  rows: CourseRow[];
  /** Optional attainment trend across batches, oldest first. */
  trend?: { batchName: string; meanPo: number | null }[];
  target: number | null;
}

export interface AppendixData {
  institutionName: string;
  generatedAt: Date;
  engineVersion: string;
  /** The parameters actually applied, per course, so the appendix is specific. */
  courses: {
    code: string;
    title: string;
    programmeName: string;
    parameters: Parameters;
    provenance: Record<keyof Parameters, ParameterSource> | null;
  }[];
}
