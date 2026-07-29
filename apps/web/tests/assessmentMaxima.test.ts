import { describe, expect, it } from 'vitest';
import { assessmentMaxima, formatMark, type ItemMax, type SectionRule } from '../lib/assessmentMaxima';

/**
 * An assessment's maximum (§3.1). Pure — no database.
 *
 * The figure faculty check a paper against, so the "answer any n of m"
 * case matters: summing all questions of an optional section overstates
 * what any student can score.
 */

const item = (maxMark: number, sectionId: string | null = null): ItemMax => ({ sectionId, maxMark });
const section = (id: string, optionalAnswerCount: number | null): SectionRule => ({ id, optionalAnswerCount });

describe('compulsory papers', () => {
  it('sums a flat item list', () => {
    const result = assessmentMaxima([item(2), item(3), item(5)], []);
    expect(result.totalItemMarks).toBe(10);
    expect(result.obtainableMax).toBe(10);
    expect(result.hasOptionalSections).toBe(false);
  });

  it('handles a single score as its one item', () => {
    expect(assessmentMaxima([item(75)], []).obtainableMax).toBe(75);
  });

  it('sums sections where every question is compulsory', () => {
    const items = [item(10, 'A'), item(10, 'A'), item(5, 'B')];
    const result = assessmentMaxima(items, [section('A', null), section('B', null)]);
    expect(result.totalItemMarks).toBe(25);
    expect(result.obtainableMax).toBe(25);
    expect(result.hasOptionalSections).toBe(false);
  });

  it('reports zero for an assessment with no items yet', () => {
    const result = assessmentMaxima([], []);
    expect(result.totalItemMarks).toBe(0);
    expect(result.obtainableMax).toBe(0);
  });
});

describe('"answer any n of m" (§3.1)', () => {
  it('counts only the questions a student may answer', () => {
    // Five 10-mark questions, answer any three → 30 obtainable, 50 printed.
    const items = [item(10, 'A'), item(10, 'A'), item(10, 'A'), item(10, 'A'), item(10, 'A')];
    const result = assessmentMaxima(items, [section('A', 3)]);
    expect(result.totalItemMarks).toBe(50);
    expect(result.obtainableMax).toBe(30);
    expect(result.hasOptionalSections).toBe(true);
  });

  it('takes the highest-valued questions when they differ', () => {
    // Answering the two best of 8/5/3 is 13, not the first two listed.
    const items = [item(3, 'A'), item(8, 'A'), item(5, 'A')];
    expect(assessmentMaxima(items, [section('A', 2)]).obtainableMax).toBe(13);
  });

  it('caps nothing when the rule allows every question', () => {
    const items = [item(10, 'A'), item(10, 'A')];
    const result = assessmentMaxima(items, [section('A', 2)]);
    expect(result.obtainableMax).toBe(20);
    expect(result.hasOptionalSections).toBe(false);
  });

  it('caps nothing when the rule exceeds the questions present', () => {
    // A section rule of 5 with only 2 questions written so far.
    const result = assessmentMaxima([item(10, 'A'), item(10, 'A')], [section('A', 5)]);
    expect(result.obtainableMax).toBe(20);
    expect(result.hasOptionalSections).toBe(false);
  });

  it('mixes compulsory and optional sections correctly', () => {
    // A: 4×5 answer any 2 = 10. B: 2×10 compulsory = 20. Total printed 40.
    const items = [
      item(5, 'A'), item(5, 'A'), item(5, 'A'), item(5, 'A'),
      item(10, 'B'), item(10, 'B'),
    ];
    const result = assessmentMaxima(items, [section('A', 2), section('B', null)]);
    expect(result.totalItemMarks).toBe(40);
    expect(result.obtainableMax).toBe(30);
    expect(result.hasOptionalSections).toBe(true);
  });

  it('includes unsectioned items in full alongside an optional section', () => {
    const items = [item(7), item(10, 'A'), item(10, 'A')];
    expect(assessmentMaxima(items, [section('A', 1)]).obtainableMax).toBe(17);
  });

  it('treats a nonsensical zero allowance as zero, not as everything', () => {
    expect(assessmentMaxima([item(10, 'A'), item(10, 'A')], [section('A', 0)]).obtainableMax).toBe(0);
  });

  it('ignores a rule for a section with no items', () => {
    expect(assessmentMaxima([item(4)], [section('empty', 2)]).obtainableMax).toBe(4);
  });
});

describe('formatting', () => {
  it('trims the float noise of summed decimal marks', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in binary floating point.
    expect(formatMark(0.1 + 0.2)).toBe('0.3');
    expect(formatMark(2.5)).toBe('2.5');
    expect(formatMark(100)).toBe('100');
  });

  it('keeps half marks intact', () => {
    const result = assessmentMaxima([item(2.5), item(2.5), item(2.5)], []);
    expect(formatMark(result.obtainableMax)).toBe('7.5');
  });
});
