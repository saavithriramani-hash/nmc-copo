/**
 * Consolidation grouping and filtering — pure, unit-tested.
 *
 * The institution report is broken down by department and then by
 * programme; the programme report can be narrowed to one semester or one
 * batch. Means are computed over the courses that produced a value; a
 * course whose PO could not be computed is excluded from the mean rather
 * than counted as zero (the same rule the engine applies to COs).
 */

export interface CourseRow {
  courseId: string;
  code: string;
  title: string;
  semester: number;
  batchName: string;
  programmeName: string;
  departmentName: string;
  /** PO code → official attainment; null = not computable. */
  po: Record<string, number | null>;
  warningCount: number;
  error?: string;
}

export interface MeanCell {
  mean: number | null;
  /** How many courses contributed a value. */
  n: number;
}

export function meanByPo(rows: CourseRow[], poCodes: string[]): Record<string, MeanCell> {
  const out: Record<string, MeanCell> = {};
  for (const code of poCodes) {
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const value = row.po[code];
      if (value !== null && value !== undefined) {
        sum += value;
        n += 1;
      }
    }
    out[code] = { mean: n === 0 ? null : sum / n, n };
  }
  return out;
}

export interface Filter {
  semester?: number;
  batchName?: string;
}

export function applyFilter(rows: CourseRow[], filter: Filter): CourseRow[] {
  return rows.filter(
    (row) =>
      (filter.semester === undefined || row.semester === filter.semester) &&
      (filter.batchName === undefined || row.batchName === filter.batchName),
  );
}

export interface ProgrammeGroup {
  programmeName: string;
  rows: CourseRow[];
  means: Record<string, MeanCell>;
}

export interface DepartmentGroup {
  departmentName: string;
  programmes: ProgrammeGroup[];
  rows: CourseRow[];
  means: Record<string, MeanCell>;
}

/** Department → programme breakdown for the institution report (FR-21). */
export function groupByDepartment(rows: CourseRow[], poCodes: string[]): DepartmentGroup[] {
  const departments = new Map<string, Map<string, CourseRow[]>>();
  for (const row of rows) {
    const programmes = departments.get(row.departmentName) ?? new Map<string, CourseRow[]>();
    const list = programmes.get(row.programmeName) ?? [];
    list.push(row);
    programmes.set(row.programmeName, list);
    departments.set(row.departmentName, programmes);
  }

  return [...departments.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([departmentName, programmes]) => {
      const programmeGroups = [...programmes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([programmeName, list]) => ({
          programmeName,
          rows: [...list].sort((a, b) => a.code.localeCompare(b.code)),
          means: meanByPo(list, poCodes),
        }));
      const allRows = programmeGroups.flatMap((group) => group.rows);
      return {
        departmentName,
        programmes: programmeGroups,
        rows: allRows,
        means: meanByPo(allRows, poCodes),
      };
    });
}

/** Distinct semesters present, ascending — for the report's contents page. */
export function semestersPresent(rows: CourseRow[]): number[] {
  return [...new Set(rows.map((row) => row.semester))].sort((a, b) => a - b);
}
