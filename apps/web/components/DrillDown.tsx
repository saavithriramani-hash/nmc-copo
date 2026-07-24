import { ratioGte } from '@copo/engine';
import type { CourseInput, CourseResult, ItemScore } from '@copo/engine';
import type { Refs } from '@/lib/compute';

/**
 * The audit drill-down (FR-14/FR-15). From any PO figure a user follows
 * the arithmetic back: Step 10 → Step 9 → the weight groups (Step 5) →
 * the assessments (Step 4) → the sections → the individual item (Step 3)
 * → the students who cleared its threshold, with their raw marks.
 *
 * Every level states its inputs, its arithmetic, and the Procedure step
 * it implements. Rendered server-side with native <details> disclosure:
 * no JavaScript, keyboard-operable, and the whole chain is present on the
 * page — an auditor never leaves the screen to reach a raw mark.
 */

const fmt = (value: number | null | undefined, dp = 4): string => {
  if (value === null || value === undefined) return '—';
  const fixed = value.toFixed(dp);
  return fixed.replace(/\.?0+$/, '') || '0';
};
const pct = (value: number | null): string => (value === null ? '—' : `${value.toFixed(2).replace(/\.?0+$/, '')}%`);

function Step({ n, children }: { n: number | string; children: React.ReactNode }) {
  return (
    <p className="text-xs text-gray-600">
      <span className="inline-block bg-gray-200 text-gray-800 rounded px-1.5 py-0.5 font-medium mr-2">Step {n}</span>
      {children}
    </p>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 my-1 overflow-x-auto">{children}</p>;
}

export function DrillDown({ result, input, refs }: { result: CourseResult; input: CourseInput; refs: Refs }) {
  const coCode = (id: string) => refs.coCodeById[id] ?? id;
  const poCode = (id: string) => refs.poCodeById[id] ?? id;
  const assessmentName = (id: string) => refs.assessmentNameById[id] ?? id;
  const sectionName = (id: string) => refs.sectionNameById[id] ?? id;
  const itemLabel = (id: string) => refs.itemLabelById[id] ?? id;

  const finalByCo = new Map(result.finalCo.map((co) => [co.coId, co]));
  const indirectByCo = new Map(result.indirect.map((row) => [row.coId, row]));
  const marksByAssessment = new Map(input.assessments.map((a) => [a.id, a.marks]));

  return (
    <div className="space-y-2">
      {result.po.map((po) => (
        <details key={po.poId} className="border border-gray-300 rounded bg-white">
          <summary className="cursor-pointer px-3 py-2 hover:bg-blue-50 flex items-baseline gap-3">
            <span className="font-medium">{poCode(po.poId)}</span>
            <span className="text-lg tabular-nums">{fmt(po.official, 3)}</span>
            <span className="text-xs text-gray-500">official · secondary {fmt(po.secondary, 3)}</span>
          </summary>
          <div className="px-4 py-3 border-t border-gray-200 space-y-3">
            <Step n={10}>Project the final CO attainment onto this PO/PSO through the mapping.</Step>
            <Formula>
              PO = weightage × (mean final CO attainment) ÷ 3 = {fmt(po.weightage)} × {fmt(po.meanFinalCo)} ÷ 3 ={' '}
              <b>{fmt(po.official)}</b>
            </Formula>
            <p className="text-xs text-gray-600">
              The official figure, as the Procedure defines it. The secondary column below is the CO-weighted
              alternative, computed for comparison only.
            </p>
            <Formula>
              secondary = Σ(strength × final) ÷ Σ(strength) ={' '}
              {po.secondaryTerms.length === 0
                ? '—'
                : `(${po.secondaryTerms.map((t) => `${t.strength}×${fmt(t.final, 3)}`).join(' + ')}) ÷ ${po.secondaryTerms.reduce((s, t) => s + t.strength, 0)}`}{' '}
              = <b>{fmt(po.secondary)}</b>
            </Formula>

            {/* Step 1 — where the weightage came from */}
            <details className="border border-gray-200 rounded">
              <summary className="cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-50">
                Weightage {fmt(po.weightage)} — from the articulation matrix
              </summary>
              <div className="px-3 py-2 border-t border-gray-200 space-y-1">
                <Step n={1}>weightage = mean of the CO mapping strengths for this PO/PSO.</Step>
                {po.weightage === null ? (
                  <p className="text-xs text-red-700">No CO maps to this PO/PSO, so no weightage can be computed.</p>
                ) : (
                  <>
                    <table className="border-collapse text-sm">
                      <tbody>
                        {result.step1.perPo
                          .find((entry) => entry.poId === po.poId)
                          ?.strengths.map((s) => (
                            <tr key={s.coId}>
                              <td className="border border-gray-300 px-2 py-0.5">{coCode(s.coId)}</td>
                              <td className="border border-gray-300 px-2 py-0.5 text-center">{s.strength}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    <Formula>
                      mean of ({result.step1.perPo.find((e) => e.poId === po.poId)?.strengths.map((s) => s.strength).join(', ')}) ={' '}
                      <b>{fmt(po.weightage)}</b>
                    </Formula>
                  </>
                )}
              </div>
            </details>

            {/* Mean final CO → each CO's Step 9 */}
            <div className="space-y-2">
              <p className="text-xs text-gray-600">
                Mean final CO attainment <b>{fmt(po.meanFinalCo)}</b> over{' '}
                {po.contributingCoIds.length} CO{po.contributingCoIds.length === 1 ? '' : 's'} with a value
                {po.contributingCoIds.length > 0 ? `: ${po.contributingCoIds.map(coCode).join(', ')}` : ''}. Expand a CO
                to follow its arithmetic down to the marks.
              </p>
              {po.contributingCoIds.map((coId) => {
                const co = finalByCo.get(coId);
                if (!co) return null;
                return (
                  <details key={coId} className="border border-gray-200 rounded">
                    <summary className="cursor-pointer px-3 py-1.5 text-sm hover:bg-gray-50 flex items-baseline gap-3">
                      <span className="font-medium">{coCode(coId)}</span>
                      <span className="tabular-nums">final {fmt(co.final, 3)}</span>
                      {co.belowTarget ? <span className="text-xs text-amber-700">below target {co.targetAttainment}</span> : null}
                    </summary>
                    <div className="px-3 py-2 border-t border-gray-200 space-y-2">
                      <Step n={9}>Blend the direct measures, then fold in the indirect measure.</Step>
                      <Formula>
                        direct = Σ weight × group level ={' '}
                        {co.groupTerms.length === 0
                          ? '—'
                          : co.groupTerms.map((t) => `${fmt(t.weightUsed)}×${fmt(t.level, 3)}`).join(' + ')} ={' '}
                        <b>{fmt(co.direct)}</b>
                      </Formula>
                      <Formula>
                        {co.directOnly ? (
                          <>final = direct = <b>{fmt(co.final)}</b> (no indirect feedback — direct-only, flagged)</>
                        ) : (
                          <>
                            final = {co.directWeight} × {fmt(co.direct)} + {co.indirectWeight} × {fmt(co.indirect)} ={' '}
                            <b>{fmt(co.final)}</b>
                          </>
                        )}
                      </Formula>

                      {co.groupTerms.some((t) => t.weightUsed !== t.declaredWeight) ? (
                        <p className="text-xs text-amber-800">
                          Weights were renormalised over the groups that assessed this CO (a declared group had no value
                          for it), so they still sum to 1.
                        </p>
                      ) : null}

                      {/* Step 8 — indirect */}
                      {(() => {
                        const ind = indirectByCo.get(coId);
                        if (!ind) return null;
                        return (
                          <details className="border border-gray-200 rounded">
                            <summary className="cursor-pointer px-3 py-1 text-xs hover:bg-gray-50">
                              Indirect {fmt(ind.value, 3)} — {ind.responses} feedback response(s)
                            </summary>
                            <div className="px-3 py-2 border-t border-gray-200">
                              <Step n={8}>Weighted mean of the 3-point CO-wise feedback.</Step>
                              <Formula>
                                (1×{ind.n1} + 2×{ind.n2} + 3×{ind.n3}) ÷ {ind.responses} = <b>{fmt(ind.value)}</b>
                              </Formula>
                            </div>
                          </details>
                        );
                      })()}

                      {/* Step 5 — each weight group */}
                      {co.groupTerms.map((term) => {
                        const group = result.groupCo.find((g) => g.groupId === term.groupId && g.coId === coId);
                        return (
                          <details key={term.groupId} className="border border-gray-200 rounded">
                            <summary className="cursor-pointer px-3 py-1 text-xs hover:bg-gray-50 flex items-baseline gap-2">
                              <span className="font-medium">{term.groupId}</span>
                              <span className="tabular-nums">level {fmt(term.level, 3)}</span>
                              <span className="text-gray-500">
                                weight {fmt(term.weightUsed)}
                                {term.weightUsed !== term.declaredWeight ? ` (declared ${fmt(term.declaredWeight)})` : ''}
                              </span>
                            </summary>
                            <div className="px-3 py-2 border-t border-gray-200 space-y-2">
                              <Step n={5}>
                                Group level = mean of the assessment levels in this group in which the CO appears.
                              </Step>
                              <Formula>
                                mean of ({group?.contributions.map((c) => fmt(c.level, 3)).join(', ') ?? '—'}) ={' '}
                                <b>{fmt(term.level)}</b>
                              </Formula>
                              {group?.contributions.map((contribution) => (
                                <AssessmentDetail
                                  key={contribution.assessmentId}
                                  result={result}
                                  coId={coId}
                                  assessmentId={contribution.assessmentId}
                                  level={contribution.level}
                                  names={{ assessmentName, sectionName, itemLabel, coCode }}
                                  marks={marksByAssessment.get(contribution.assessmentId) ?? {}}
                                  refs={refs}
                                />
                              ))}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

/** Step 4 for one assessment × one CO, down to items and raw marks. */
function AssessmentDetail({
  result,
  coId,
  assessmentId,
  level,
  names,
  marks,
  refs,
}: {
  result: CourseResult;
  coId: string;
  assessmentId: string;
  level: number;
  names: { assessmentName: (id: string) => string; sectionName: (id: string) => string; itemLabel: (id: string) => string; coCode: (id: string) => string };
  marks: Record<string, Record<string, number | null>>;
  refs: Refs;
}) {
  const row = result.assessmentCo.find((r) => r.assessmentId === assessmentId && r.coId === coId);
  const scoreOf = (itemId: string): ItemScore | undefined =>
    result.itemScores.find((s) => s.assessmentId === assessmentId && s.itemId === itemId);

  return (
    <details className="border border-gray-200 rounded ml-3">
      <summary className="cursor-pointer px-3 py-1 text-xs hover:bg-gray-50 flex items-baseline gap-2">
        <span className="font-medium">{names.assessmentName(assessmentId)}</span>
        <span className="tabular-nums">level {fmt(level, 3)}</span>
      </summary>
      <div className="px-3 py-2 border-t border-gray-200 space-y-2">
        {row?.cohort ? (
          <>
            <Step n={7}>
              End-semester attainment from the distribution of total scores (§4.3) — no question-wise decomposition.
            </Step>
            <table className="border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border border-gray-300 px-2 py-0.5">Score cut-off</th>
                  <th className="border border-gray-300 px-2 py-0.5">Students at or above</th>
                  <th className="border border-gray-300 px-2 py-0.5">% of cohort</th>
                  <th className="border border-gray-300 px-2 py-0.5">Needs</th>
                  <th className="border border-gray-300 px-2 py-0.5">Level</th>
                </tr>
              </thead>
              <tbody>
                {row.cohort.bands.map((band, i) => (
                  <tr key={i} className={band.passed ? 'bg-green-50' : ''}>
                    <td className="border border-gray-300 px-2 py-0.5">
                      ≥ {band.scorePercent}% of {row.cohort!.maxMark} = {fmt((band.scorePercent / 100) * row.cohort!.maxMark, 2)}
                    </td>
                    <td className="border border-gray-300 px-2 py-0.5 text-center">
                      {band.studentsAtOrAbove} of {row.cohort!.attempted}
                    </td>
                    <td className="border border-gray-300 px-2 py-0.5 text-center">{pct(band.pctOfStudents)}</td>
                    <td className="border border-gray-300 px-2 py-0.5 text-center">≥ {band.cohortPercent}%</td>
                    <td className="border border-gray-300 px-2 py-0.5 text-center font-medium">{band.passed ? band.level : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600">
              First band whose cohort test passes decides the level: <b>{row.cohort.level ?? '—'}</b>
              {row.cohort.matched === null ? ' (no band passed → 0)' : ''}.
            </p>
            <ScoreList marks={marks} itemId={assessmentId} refs={refs} maxMark={row.cohort.maxMark} thresholdFraction={null} />
          </>
        ) : row?.sections ? (
          <>
            <Step n={4}>
              Section level = mean of the item levels tagged to this CO; assessment level = mean across the sections in
              which the CO appears.
            </Step>
            <Formula>
              mean of ({row.sections.map((s) => fmt(s.level, 3)).join(', ')}) = <b>{fmt(row.level)}</b>
            </Formula>
            {row.sections.map((section) => (
              <details key={section.sectionId} className="border border-gray-200 rounded ml-3">
                <summary className="cursor-pointer px-3 py-1 text-xs hover:bg-gray-50">
                  {names.sectionName(section.sectionId)} — level {fmt(section.level, 3)}
                </summary>
                <div className="px-3 py-2 border-t border-gray-200 space-y-2">
                  <Formula>
                    mean of ({section.itemLevels.map((i) => (i.level === null ? '—' : i.level)).join(', ')}) ={' '}
                    <b>{fmt(section.level)}</b>
                  </Formula>
                  {section.itemLevels.map((entry) => (
                    <ItemDetail key={entry.itemId} score={scoreOf(entry.itemId)} label={names.itemLabel(entry.itemId)} marks={marks} refs={refs} />
                  ))}
                </div>
              </details>
            ))}
          </>
        ) : row?.items ? (
          <>
            <Step n={4}>Assessment level = mean of the item levels applying to this CO (no section layer).</Step>
            <Formula>
              mean of ({row.items.map((i) => (i.level === null ? '—' : i.level)).join(', ')}) = <b>{fmt(row.level)}</b>
            </Formula>
            {row.items.map((entry) => (
              <ItemDetail key={entry.itemId} score={scoreOf(entry.itemId)} label={names.itemLabel(entry.itemId)} marks={marks} refs={refs} />
            ))}
          </>
        ) : null}
      </div>
    </details>
  );
}

/** Step 3 for one item, then the raw marks student by student. */
function ItemDetail({
  score,
  label,
  marks,
  refs,
}: {
  score: ItemScore | undefined;
  label: string;
  marks: Record<string, Record<string, number | null>>;
  refs: Refs;
}) {
  if (!score) return null;
  return (
    <details className="border border-gray-200 rounded ml-3">
      <summary className="cursor-pointer px-3 py-1 text-xs hover:bg-gray-50 flex items-baseline gap-2">
        <span className="font-medium">{label}</span>
        <span>/{score.maxMark}</span>
        <span className="tabular-nums">
          {score.cleared}/{score.attempted} cleared = {pct(score.pct)} → level {score.level ?? '—'}
        </span>
      </summary>
      <div className="px-3 py-2 border-t border-gray-200 space-y-2">
        <Step n={3}>
          Count who attempted, count who cleared the threshold, take the percentage, read the level from the band table.
        </Step>
        <Formula>
          threshold = {score.thresholdFraction} × {score.maxMark} = {fmt(score.thresholdMark, 2)} · attempted{' '}
          {score.attempted} (blanks excluded) · cleared {score.cleared}
        </Formula>
        <Formula>
          {score.attempted === 0 ? (
            <>nobody attempted this item — no percentage, no level (warned, never counted as zero)</>
          ) : (
            <>
              {score.cleared} ÷ {score.attempted} × 100 = {pct(score.pct)} → band ≥ {score.matchedBand?.lowerBound}% →
              level <b>{score.level}</b>
            </>
          )}
        </Formula>
        <ScoreList marks={marks} itemId={score.itemId} refs={refs} maxMark={score.maxMark} thresholdFraction={score.thresholdFraction} />
      </div>
    </details>
  );
}

/**
 * The raw marks — the bottom of the chain. "Cleared" is decided by the
 * ENGINE'S OWN comparison (ratioGte), so this list can never disagree
 * with the count it is explaining.
 */
function ScoreList({
  marks,
  itemId,
  refs,
  maxMark,
  thresholdFraction,
}: {
  marks: Record<string, Record<string, number | null>>;
  itemId: string;
  refs: Refs;
  maxMark: number;
  /** null for a cohort-band assessment, which has no per-item threshold. */
  thresholdFraction: number | null;
}) {
  const rows = Object.entries(marks)
    .map(([enrolmentId, row]) => ({
      enrolmentId,
      student: refs.studentByEnrolmentId[enrolmentId],
      value: row[itemId] ?? null,
    }))
    .sort((a, b) => (a.student?.registerNumber ?? '').localeCompare(b.student?.registerNumber ?? ''));

  if (rows.length === 0) return <p className="text-xs text-gray-500">No marks recorded.</p>;

  return (
    <details className="border border-gray-200 rounded">
      <summary className="cursor-pointer px-3 py-1 text-xs hover:bg-gray-50">Raw marks ({rows.length} students)</summary>
      <div className="px-3 py-2 border-t border-gray-200 max-h-64 overflow-y-auto">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-left">
              <th className="border border-gray-300 px-2 py-0.5">Register no.</th>
              <th className="border border-gray-300 px-2 py-0.5">Student</th>
              <th className="border border-gray-300 px-2 py-0.5">Mark</th>
              <th className="border border-gray-300 px-2 py-0.5">Counted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const blank = row.value === null;
              const cleared = thresholdFraction !== null && !blank && ratioGte(row.value as number, maxMark, thresholdFraction);
              return (
                <tr key={row.enrolmentId} className={blank ? 'bg-gray-50 text-gray-500' : ''}>
                  <td className="border border-gray-300 px-2 py-0.5 font-mono">{row.student?.registerNumber ?? row.enrolmentId}</td>
                  <td className="border border-gray-300 px-2 py-0.5">{row.student?.fullName ?? ''}</td>
                  <td className="border border-gray-300 px-2 py-0.5 text-center tabular-nums">{blank ? 'blank' : row.value}</td>
                  <td className="border border-gray-300 px-2 py-0.5 text-center">
                    {blank ? (
                      'did not attempt — excluded'
                    ) : thresholdFraction === null ? (
                      'counted'
                    ) : cleared ? (
                      <span className="text-green-700 font-medium">cleared</span>
                    ) : (
                      'attempted, did not clear'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
