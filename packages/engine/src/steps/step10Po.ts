import type { EngineWarning, FinalCoAttainment, PoAttainment, Step1Result } from '../types';
import { makeWarning, meanOrNull } from '../util';

/**
 * Procedure Step 10 — project final CO attainment onto POs and PSOs.
 *
 * Official figure (the one reported):
 *   PO_j = weightage_j × (mean final CO attainment) ÷ 3
 * The mean is over every CO with a final value — the same mean for every
 * PO, exactly as the Procedure computes it.
 *
 * Secondary comparison column (shown alongside, never reported as the
 * official figure):
 *   PO_j = Σ_i (M_ij × final_i) ÷ Σ_i M_ij
 * over the COs that map to PO_j and have a final value.
 *
 * COs without a final value are excluded from both the mean and the
 * secondary sum — numerator and denominator alike — with their warnings
 * already raised upstream. The weightage always comes from the full
 * matrix (Step 1), because it is a property of the mapping, not of which
 * COs could be computed. A PO with no mapped COs stays null (PO_UNMAPPED
 * raised in Step 1); if no CO has a final value at all, every PO is null
 * with a NO_ASSESSED_COS warning — never zero.
 */
export function step10PoAttainment(
  step1: Step1Result,
  finalCo: FinalCoAttainment[],
): { results: PoAttainment[]; warnings: EngineWarning[] } {
  const warnings: EngineWarning[] = [];

  const finalByCo = new Map<string, number>();
  const contributingCoIds: string[] = [];
  for (const co of finalCo) {
    if (co.final !== null) {
      finalByCo.set(co.coId, co.final);
      contributingCoIds.push(co.coId);
    }
  }

  const meanFinalCo = meanOrNull([...finalByCo.values()]);
  if (meanFinalCo === null) {
    warnings.push(
      makeWarning('NO_ASSESSED_COS', 'warning', 'No CO has a final attainment value; PO/PSO attainment cannot be computed.', {}),
    );
  }

  const results: PoAttainment[] = step1.perPo.map(({ poId, weightage, strengths }) => {
    const secondaryTerms = strengths
      .filter((s) => finalByCo.has(s.coId))
      .map((s) => ({ coId: s.coId, strength: s.strength, final: finalByCo.get(s.coId) as number }));

    let secondary: number | null = null;
    if (secondaryTerms.length > 0) {
      let num = 0;
      let den = 0;
      for (const t of secondaryTerms) {
        num += t.strength * t.final;
        den += t.strength;
      }
      secondary = num / den;
    }

    return {
      procedureStep: 10,
      poId,
      weightage,
      meanFinalCo,
      contributingCoIds: [...contributingCoIds],
      official: weightage !== null && meanFinalCo !== null ? (weightage * meanFinalCo) / 3 : null,
      secondary,
      secondaryTerms,
    };
  });

  return { results, warnings };
}
