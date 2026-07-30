'use client';

import { useState, useTransition } from 'react';
import { saveInstitutionParametersAction } from '@/actions/institutionSettings';
import { weightSum, type ParametersDraft } from '@/lib/institutionParams';

/**
 * Institution bands and weights (§4.2-§4.4). Dense tables with explicit
 * Save, in the manner of the CO and matrix editors. The weight total is
 * shown live because "must sum to 1.00" is the rule most easily broken.
 */
export function InstitutionParameters({ initial, canEdit }: { initial: ParametersDraft; canEdit: boolean }) {
  const [draft, setDraft] = useState<ParametersDraft>(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const touch = (next: ParametersDraft) => {
    setDraft(next);
    setDirty(true);
    setErrors([]);
    setMessage(null);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveInstitutionParametersAction(draft);
      setErrors(result.errors ?? (result.error ? [result.error] : []));
      setMessage(result.ok ? (result.message ?? 'Saved.') : null);
      if (result.ok) setDirty(false);
    });

  const total = weightSum(draft.weightGroups);
  const totalOk = Math.abs(total - 1) < 1e-9;
  const blend = Number(draft.directWeight || 0) + Number(draft.indirectWeight || 0);
  const blendOk = Math.abs(blend - 1) < 1e-9;

  const cell = 'border border-gray-300 px-1 py-0.5';
  const input = 'w-full border-0 px-1 py-1 text-right disabled:bg-gray-100';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── §4.2 attainment bands ── */}
      <section className="space-y-2">
        <div>
          <h2 className="font-medium">Attainment bands (Step 3)</h2>
          <p className="text-xs text-gray-600">
            The proportion of students who clear the threshold on an item decides its level. Each row is a lower
            bound in percent. A row with lower bound 0 is required, so that every result matches something.
          </p>
        </div>
        <table className="bg-white border-collapse w-96">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className={`${cell} w-56`}>At least this % of students</th>
              <th className={`${cell} w-24`}>Level</th>
              <th className={`${cell} w-16`}></th>
            </tr>
          </thead>
          <tbody>
            {draft.bands.map((row, i) => (
              <tr key={i}>
                <td className={cell}>
                  <input
                    value={row.lowerBound}
                    disabled={!canEdit}
                    onChange={(e) =>
                      touch({ ...draft, bands: draft.bands.map((b, j) => (i === j ? { ...b, lowerBound: e.target.value } : b)) })
                    }
                    className={input}
                    inputMode="decimal"
                    aria-label={`Band ${i + 1} lower bound`}
                  />
                </td>
                <td className={cell}>
                  <input
                    value={row.level}
                    disabled={!canEdit}
                    onChange={(e) =>
                      touch({ ...draft, bands: draft.bands.map((b, j) => (i === j ? { ...b, level: e.target.value } : b)) })
                    }
                    className={input}
                    inputMode="numeric"
                    aria-label={`Band ${i + 1} level`}
                  />
                </td>
                <td className={`${cell} text-center`}>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => touch({ ...draft, bands: draft.bands.filter((_, j) => j !== i) })}
                      className="text-red-700 hover:underline text-xs"
                    >
                      remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit ? (
          <button
            type="button"
            onClick={() => touch({ ...draft, bands: [...draft.bands, { lowerBound: '', level: '' }] })}
            className="border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-100"
          >
            + band
          </button>
        ) : null}
      </section>

      {/* ── §4.3 end-semester cohort bands ── */}
      <section className="space-y-2">
        <div>
          <h2 className="font-medium">End-semester bands (Step 7)</h2>
          <p className="text-xs text-gray-600">
            The end-semester paper is scored from its total, not question by question. A row passes when at least
            the cohort % of students score at least the score % of the paper maximum. Stored as percentages, so a
            100-, 75- or 50-mark paper works unchanged. No row matching means level 0.
          </p>
        </div>
        <table className="bg-white border-collapse w-[34rem]">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className={`${cell} w-56`}>Students scoring at least (% of max)</th>
              <th className={`${cell} w-40`}>…being at least (% of cohort)</th>
              <th className={`${cell} w-24`}>Level</th>
              <th className={`${cell} w-16`}></th>
            </tr>
          </thead>
          <tbody>
            {draft.cohortBands.map((row, i) => (
              <tr key={i}>
                {(['scorePercent', 'cohortPercent', 'level'] as const).map((field) => (
                  <td className={cell} key={field}>
                    <input
                      value={row[field]}
                      disabled={!canEdit}
                      onChange={(e) =>
                        touch({
                          ...draft,
                          cohortBands: draft.cohortBands.map((b, j) => (i === j ? { ...b, [field]: e.target.value } : b)),
                        })
                      }
                      className={input}
                      inputMode="decimal"
                      aria-label={`End-semester band ${i + 1} ${field}`}
                    />
                  </td>
                ))}
                <td className={`${cell} text-center`}>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => touch({ ...draft, cohortBands: draft.cohortBands.filter((_, j) => j !== i) })}
                      className="text-red-700 hover:underline text-xs"
                    >
                      remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit ? (
          <button
            type="button"
            onClick={() =>
              touch({ ...draft, cohortBands: [...draft.cohortBands, { scorePercent: '', cohortPercent: '', level: '' }] })
            }
            className="border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-100"
          >
            + band
          </button>
        ) : null}
      </section>

      {/* ── §4.4 weight groups ── */}
      <section className="space-y-2">
        <div>
          <h2 className="font-medium">Weight groups (Step 9)</h2>
          <p className="text-xs text-gray-600">
            Each assessment belongs to a weight group, and the group weights decide the direct attainment.
            Assignments, quizzes and seminars share the continuous group. The weights must add up to exactly 1.00.
          </p>
        </div>
        <table className="bg-white border-collapse w-96">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className={`${cell} w-56`}>Group</th>
              <th className={`${cell} w-24`}>Weight</th>
              <th className={`${cell} w-16`}></th>
            </tr>
          </thead>
          <tbody>
            {draft.weightGroups.map((row, i) => (
              <tr key={i}>
                <td className={cell}>
                  <input
                    value={row.name}
                    disabled={!canEdit}
                    onChange={(e) =>
                      touch({
                        ...draft,
                        weightGroups: draft.weightGroups.map((g, j) => (i === j ? { ...g, name: e.target.value } : g)),
                      })
                    }
                    className={`${input} text-left`}
                    aria-label={`Weight group ${i + 1} name`}
                  />
                </td>
                <td className={cell}>
                  <input
                    value={row.weight}
                    disabled={!canEdit}
                    onChange={(e) =>
                      touch({
                        ...draft,
                        weightGroups: draft.weightGroups.map((g, j) => (i === j ? { ...g, weight: e.target.value } : g)),
                      })
                    }
                    className={input}
                    inputMode="decimal"
                    aria-label={`Weight group ${i + 1} weight`}
                  />
                </td>
                <td className={`${cell} text-center`}>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => touch({ ...draft, weightGroups: draft.weightGroups.filter((_, j) => j !== i) })}
                      className="text-red-700 hover:underline text-xs"
                    >
                      remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            <tr className={totalOk ? 'bg-blue-50' : 'bg-red-50'}>
              <td className={`${cell} text-xs font-medium`}>Total</td>
              <td className={`${cell} text-right text-xs font-medium`}>{total.toFixed(2)}</td>
              <td className={cell}></td>
            </tr>
          </tbody>
        </table>
        {!totalOk ? <p className="text-xs text-red-700">The weights must add up to 1.00 — currently {total.toFixed(2)}.</p> : null}
        {canEdit ? (
          <button
            type="button"
            onClick={() => touch({ ...draft, weightGroups: [...draft.weightGroups, { name: '', weight: '' }] })}
            className="border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-100"
          >
            + group
          </button>
        ) : null}
      </section>

      {/* ── §4.4 direct / indirect blend ── */}
      <section className="space-y-2">
        <div>
          <h2 className="font-medium">Direct and indirect blend (Step 9)</h2>
          <p className="text-xs text-gray-600">
            The final CO attainment is this blend of the measured (direct) figure and student feedback (indirect).
            The two must add up to 1.00.
          </p>
        </div>
        <div className="flex gap-3 items-end">
          {(['directWeight', 'indirectWeight'] as const).map((field) => (
            <label className="block" key={field}>
              <span className="block text-xs font-medium text-gray-700 mb-1">
                {field === 'directWeight' ? 'Direct' : 'Indirect'}
              </span>
              <input
                value={draft[field]}
                disabled={!canEdit}
                onChange={(e) => touch({ ...draft, [field]: e.target.value })}
                className="w-28 border border-gray-300 rounded px-2 py-1.5 text-right disabled:bg-gray-100"
                inputMode="decimal"
                aria-label={field === 'directWeight' ? 'Direct weight' : 'Indirect weight'}
              />
            </label>
          ))}
          <p className={`text-xs pb-2 ${blendOk ? 'text-gray-600' : 'text-red-700'}`}>Total {blend.toFixed(2)}</p>
        </div>
      </section>

      {errors.length > 0 ? (
        <ul className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 space-y-1">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || pending}
            className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save parameters'}
          </button>
          {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          {message ? <span className="text-xs text-green-800">{message}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500">Read-only. These are set by the Dean.</p>
      )}
    </div>
  );
}
