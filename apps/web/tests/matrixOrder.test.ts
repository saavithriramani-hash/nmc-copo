import { describe, expect, it } from 'vitest';
import { orderOutcomes } from '../lib/matrixOrder';

/**
 * Regression: the matrix grid rendered columns as POs-then-PSOs but
 * addressed cells through the displayOrder-sorted prop. Where a
 * programme numbered a PO after a PSO — as the pilot programme does,
 * PO6 sitting at displayOrder 8 behind both PSOs — typing a correlation
 * into the PO6 cell stored it against PSO1, silently, and that wrong
 * mapping fed Step 1's weightages and every PO attainment figure.
 *
 * These pin the ordering itself. The guarantee that the grid *addresses*
 * columns through this order is exercised in the browser.
 */

const po = (id: string) => ({ id, kind: 'PO' as const });
const pso = (id: string) => ({ id, kind: 'PSO' as const });
const ids = (list: { id: string }[]) => list.map((o) => o.id);

describe('matrix column order', () => {
  it('puts every PO before every PSO', () => {
    const ordered = orderOutcomes([po('PO1'), pso('PSO1'), po('PO2'), pso('PSO2')]);
    expect(ids(ordered)).toEqual(['PO1', 'PO2', 'PSO1', 'PSO2']);
  });

  it('handles the pilot programme, where PO6 is numbered after both PSOs', () => {
    // Exactly the seeded displayOrder that made this fail in practice.
    const incoming = [po('PO1'), po('PO2'), po('PO3'), po('PO4'), po('PO5'), pso('PSO1'), pso('PSO2'), po('PO6')];
    expect(ids(orderOutcomes(incoming))).toEqual(['PO1', 'PO2', 'PO3', 'PO4', 'PO5', 'PO6', 'PSO1', 'PSO2']);
  });

  it('preserves the incoming relative order within each kind', () => {
    const ordered = orderOutcomes([po('PO3'), pso('PSO2'), po('PO1'), pso('PSO1')]);
    expect(ids(ordered)).toEqual(['PO3', 'PO1', 'PSO2', 'PSO1']);
  });

  it('keeps every outcome exactly once — no column dropped or duplicated', () => {
    const incoming = [po('a'), pso('b'), po('c'), pso('d'), po('e')];
    const ordered = orderOutcomes(incoming);
    expect(ordered).toHaveLength(incoming.length);
    expect(new Set(ids(ordered))).toEqual(new Set(ids(incoming)));
  });

  it('is idempotent, so an already-ordered list is left alone', () => {
    const once = orderOutcomes([po('PO1'), pso('PSO1'), po('PO2')]);
    expect(orderOutcomes(once)).toEqual(once);
  });

  it('copes with only POs, only PSOs, and none at all', () => {
    expect(ids(orderOutcomes([po('PO1'), po('PO2')]))).toEqual(['PO1', 'PO2']);
    expect(ids(orderOutcomes([pso('PSO1')]))).toEqual(['PSO1']);
    expect(orderOutcomes([])).toEqual([]);
  });

  it('does not mutate the input', () => {
    const incoming = [pso('PSO1'), po('PO1')];
    const copy = [...incoming];
    orderOutcomes(incoming);
    expect(incoming).toEqual(copy);
  });
});
