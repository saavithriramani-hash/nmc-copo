import { describe, expect, it } from 'vitest';
import { meanAcrossCourses, type CoursePoRow } from '../lib/consolidate';

const row = (courseId: string, po: Record<string, number | null>): CoursePoRow => ({
  courseId,
  code: courseId.toUpperCase(),
  title: '',
  semester: 1,
  po,
  warningCount: 0,
});

describe('meanAcrossCourses — consolidation aggregate (FR-20)', () => {
  it('averages per PO across courses; hand-computed', () => {
    // PO1: (1.8 + 2.4) / 2 = 2.1.  PO2: (1.0 + 2.0) / 2 = 1.5.
    const rows = [row('c1', { PO1: 1.8, PO2: 1.0 }), row('c2', { PO1: 2.4, PO2: 2.0 })];
    const means = meanAcrossCourses(rows, ['PO1', 'PO2']);
    expect(means['PO1']?.mean).toBeCloseTo(2.1, 12);
    expect(means['PO1']?.n).toBe(2);
    expect(means['PO2']?.mean).toBeCloseTo(1.5, 12);
  });

  it('a null (not computable) is excluded from the mean — never counted as zero', () => {
    // PO1 over values {2.4} only → 2.4, not (0 + 2.4)/2 = 1.2.
    const rows = [row('c1', { PO1: null }), row('c2', { PO1: 2.4 })];
    const means = meanAcrossCourses(rows, ['PO1']);
    expect(means['PO1']).toEqual({ mean: 2.4, n: 1 });
  });

  it('no contributing course → null mean, never 0', () => {
    const rows = [row('c1', { PO1: null })];
    expect(meanAcrossCourses(rows, ['PO1'])['PO1']).toEqual({ mean: null, n: 0 });
  });

  it('a PO absent from a course row is treated as not computed', () => {
    const rows = [row('c1', {}), row('c2', { PO1: 3 })];
    expect(meanAcrossCourses(rows, ['PO1'])['PO1']).toEqual({ mean: 3, n: 1 });
  });
});
