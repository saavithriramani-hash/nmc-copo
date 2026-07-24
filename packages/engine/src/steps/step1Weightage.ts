import type { CO, EngineWarning, PoMatrix, PoWeightage, Step1Result } from '../types';
import { makeWarning } from '../util';

/**
 * Procedure Step 1 — Articulation matrix.
 *
 * weightage(PO_j) = mean of the CO mapping strengths mapped to that PO/PSO.
 * Always derived from the matrix passed in — never stored, never hard-coded
 * (§9). The PO/PSO universe is the union of the matrix's inner keys, in
 * first-appearance order (CO order, then key order within a CO's row).
 *
 * A PO to which no CO maps has weightage null and a PO_UNMAPPED warning —
 * its attainment cannot be computed, and that must be visible, not zero.
 */
export function step1ArticulationWeightages(
  cos: CO[],
  poMatrix: PoMatrix,
): { result: Step1Result; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = [];

  // Deterministic PO order: first appearance across CO rows in CO order.
  const poIds: string[] = [];
  const seen = new Set<string>();
  for (const co of cos) {
    for (const poId of Object.keys(poMatrix[co.id] ?? {})) {
      if (!seen.has(poId)) {
        seen.add(poId);
        poIds.push(poId);
      }
    }
  }

  const perPo: PoWeightage[] = poIds.map((poId) => {
    const strengths: PoWeightage['strengths'] = [];
    for (const co of cos) {
      const strength = poMatrix[co.id]?.[poId];
      if (strength !== null && strength !== undefined) {
        strengths.push({ coId: co.id, strength });
      }
    }
    if (strengths.length === 0) {
      warnings.push(
        makeWarning('PO_UNMAPPED', 'warning', `No CO maps to '${poId}'; its weightage and attainment cannot be computed.`, {
          poId,
        }),
      );
      return { poId, weightage: null, strengths };
    }
    let sum = 0;
    for (const s of strengths) sum += s.strength;
    return { poId, weightage: sum / strengths.length, strengths };
  });

  return { result: { procedureStep: 1, perPo }, warnings };
}
