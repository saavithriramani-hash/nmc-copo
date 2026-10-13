/**
 * Courses grouped by programme, then by batch — the shape of the Courses
 * page and of the dashboard's course tables. Pure, so the ordering is
 * unit-testable without a database.
 *
 * ORDER: programmes by name; batches NEWEST FIRST (the current intake on
 * top, older and mostly locked ones below); courses by semester, then
 * code. Every tie falls back to a stable key, so the same data always
 * renders in the same order. A group exists only because a course is in
 * it — an empty programme or batch never appears.
 */

export interface GroupableCourse {
  code: string;
  semester: number;
  programmeId: string;
  programmeName: string;
  departmentName: string;
  batchId: string;
  batchName: string;
  batchStartYear: number;
}

export interface BatchGroup<T> {
  batchId: string;
  batchName: string;
  startYear: number;
  courses: T[];
}

export interface ProgrammeGroup<T> {
  programmeId: string;
  programmeName: string;
  departmentName: string;
  courseCount: number;
  batches: BatchGroup<T>[];
}

const byText = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export function groupCourses<T extends GroupableCourse>(courses: readonly T[]): ProgrammeGroup<T>[] {
  const programmes = new Map<string, ProgrammeGroup<T> & { byBatch: Map<string, BatchGroup<T>> }>();

  for (const course of courses) {
    let programme = programmes.get(course.programmeId);
    if (!programme) {
      programme = {
        programmeId: course.programmeId,
        programmeName: course.programmeName,
        departmentName: course.departmentName,
        courseCount: 0,
        batches: [],
        byBatch: new Map(),
      };
      programmes.set(course.programmeId, programme);
    }
    let batch = programme.byBatch.get(course.batchId);
    if (!batch) {
      batch = { batchId: course.batchId, batchName: course.batchName, startYear: course.batchStartYear, courses: [] };
      programme.byBatch.set(course.batchId, batch);
      programme.batches.push(batch);
    }
    batch.courses.push(course);
    programme.courseCount += 1;
  }

  return [...programmes.values()]
    .sort((a, b) => byText(a.programmeName, b.programmeName) || byText(a.programmeId, b.programmeId))
    .map(({ byBatch: _byBatch, ...programme }) => ({
      ...programme,
      batches: programme.batches
        .sort((a, b) => b.startYear - a.startYear || byText(b.batchName, a.batchName) || byText(a.batchId, b.batchId))
        .map((batch) => ({
          ...batch,
          courses: [...batch.courses].sort((a, b) => a.semester - b.semester || byText(a.code, b.code)),
        })),
    }));
}

/**
 * Up to this many courses, every group starts open; above it, programmes
 * start folded so a college-wide list opens as a short list of
 * programmes rather than hundreds of rows.
 */
export const OPEN_GROUPS_UP_TO = 30;

export function startsOpen(totalCourses: number): boolean {
  return totalCourses <= OPEN_GROUPS_UP_TO;
}

