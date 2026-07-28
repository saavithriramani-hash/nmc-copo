/**
 * Column order for the articulation matrix (FR-6).
 *
 * Programme outcomes arrive ordered by `displayOrder`, which does NOT
 * group the kinds: a programme may legitimately number PO6 after PSO1.
 * The grid presents POs first and PSOs second, so the rendered order and
 * the incoming order are different sequences.
 *
 * This lives here, exported and tested, because conflating the two
 * corrupted data silently: a rendered column index was used to look up
 * the incoming array, so typing a correlation into the PO6 cell stored
 * it against PSO1. Nothing warned, and the wrong mapping fed Step 1's
 * weightages and therefore every PO attainment figure.
 *
 * Whatever renders the columns must also address them through this
 * result — never through the original list.
 */
export interface OrderableOutcome {
  id: string;
  kind: 'PO' | 'PSO';
}

export function orderOutcomes<T extends OrderableOutcome>(outcomes: readonly T[]): T[] {
  return [...outcomes.filter((o) => o.kind === 'PO'), ...outcomes.filter((o) => o.kind === 'PSO')];
}
