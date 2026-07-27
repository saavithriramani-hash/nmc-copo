import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, computeCourse } from '@copo/engine';
import type { CourseInput, EngineWarning } from '@copo/engine';
import { countMarkCells, diffSnapshots, warningsFingerprint, type SnapshotForDiff } from '../lib/versionDiff';

/** A tiny computable course; s4Mark varies to change the outcome. */
function course(s4Mark: number | null): CourseInput {
  return {
    cos: [{ id: 'co1', statement: 'S', bloomLevels: ['Apply'] }],
    poMatrix: { co1: { po1: 3 } },
    parameters: { ...DEFAULT_PARAMETERS, weightGroups: { only: 1 } },
    assessments: [
      {
        id: 'a1',
        name: 'A1',
        shape: 'ITEM_LIST',
        scoringRule: 'RUBRIC',
        weightGroup: 'only',
        items: [{ id: 'i1', maxMark: 5, coTag: 'co1' }],
        marks: { S1: { i1: 5 }, S2: { i1: 4 }, S3: { i1: 3.5 }, S4: { i1: s4Mark } },
      },
    ],
    indirect: { co1: { n1: 0, n2: 0, n3: 10 } },
  };
}

function snap(input: CourseInput): SnapshotForDiff {
  return {
    input,
    result: computeCourse(input),
    coCodeById: { co1: 'CO1' },
    poCodeById: { po1: 'PO1' },
  };
}

describe('warningsFingerprint', () => {
  const warning = (code: string): EngineWarning => ({
    code: code as EngineWarning['code'],
    severity: 'warning',
    message: 'human text may vary',
    ref: { coId: 'co1' },
  });

  it('is stable for the same warnings and ignores message wording', () => {
    const a = warningsFingerprint([warning('CO_NOT_ASSESSED')]);
    const b = warningsFingerprint([{ ...warning('CO_NOT_ASSESSED'), message: 'different phrasing' }]);
    expect(a).toBe(b);
  });

  it('changes when the warning set changes', () => {
    expect(warningsFingerprint([warning('CO_NOT_ASSESSED')])).not.toBe(warningsFingerprint([]));
    expect(warningsFingerprint([warning('CO_NOT_ASSESSED')])).not.toBe(warningsFingerprint([warning('NO_INDIRECT_DATA')]));
  });
});

describe('countMarkCells — attempted cells only', () => {
  it('counts non-null marks; blanks are not cells of work', () => {
    expect(countMarkCells(course(0))).toBe(4);
    expect(countMarkCells(course(null))).toBe(3);
  });
});

describe('diffSnapshots — what changed between versions (FR-16)', () => {
  it('reports changed CO finals and PO officials with old → new', () => {
    // v1: S4 blank → item 100% → level 3 → final 3; PO1 = 3×3/3... wait:
    // weightage 3, mean final 3 → official = 3 × 3 / 3 = 3.
    // v2: S4 = 0 → 75% → level 2 → final = .9×2 + .1×3 = 2.1; official 2.1.
    const older = snap(course(null));
    const newer = snap(course(0));
    const diff = diffSnapshots(older, newer);

    expect(diff.identical).toBe(false);
    expect(diff.finalCoChanges).toHaveLength(1);
    expect(diff.finalCoChanges[0]?.code).toBe('CO1');
    expect(diff.finalCoChanges[0]?.from).toBeCloseTo(3, 12);
    expect(diff.finalCoChanges[0]?.to).toBeCloseTo(2.1, 12);
    expect(diff.poOfficialChanges[0]?.code).toBe('PO1');
    expect(diff.poOfficialChanges[0]?.to).toBeCloseTo(2.1, 12);
    expect(diff.markCellChange).toEqual({ from: 3, to: 4 });
    expect(diff.parameterChanges).toEqual([]);
  });

  it('reports parameter changes field-by-field', () => {
    const older = snap(course(0));
    const changed = course(0);
    changed.parameters = { ...changed.parameters, targetAttainment: 2.0 };
    const diff = diffSnapshots(older, snap(changed));
    expect(diff.parameterChanges).toEqual([{ field: 'targetAttainment', from: 2.5, to: 2.0 }]);
  });

  it('identical snapshots diff as identical', () => {
    expect(diffSnapshots(snap(course(0)), snap(course(0))).identical).toBe(true);
  });
});
