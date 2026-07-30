'use client';

import { useMemo, useState, useTransition } from 'react';
import { step8IndirectAttainment } from '@copo/engine';
import type { IndirectCounts } from '@copo/engine';
import { saveIndirectFeedbackAction } from '@/actions/feedback';
import {
  formatIndirect,
  parseCount,
  responsesOf,
  type FeedbackDraft,
} from '@/lib/indirectFeedback';

export interface FeedbackCo {
  id: string;
  code: string;
  statement: string;
}

/**
 * CO-wise indirect feedback (Step 8). The value beside each row is
 * computed by the ENGINE'S OWN step8IndirectAttainment as you type — the
 * same pure function the attainment computation calls — so what is shown
 * here is by construction what the report will use.
 */
export function FeedbackEditor({
  courseId,
  cos,
  initial,
  responseFloor,
  canEdit,
}: {
  courseId: string;
  cos: FeedbackCo[];
  initial: FeedbackDraft[];
  responseFloor: number;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<FeedbackDraft[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (coId: string, field: 'n1' | 'n2' | 'n3', value: string) => {
    setDraft((rows) => rows.map((row) => (row.coId === coId ? { ...row, [field]: value } : row)));
    setDirty(true);
    setErrors([]);
    setMessage(null);
  };

  /** Live Step 8, exactly as the engine computes it. */
  const preview = useMemo(() => {
    const counts: Record<string, IndirectCounts> = {};
    let malformed = false;
    for (const row of draft) {
      const n1 = parseCount(row.n1);
      const n2 = parseCount(row.n2);
      const n3 = parseCount(row.n3);
      if ('error' in n1 || 'error' in n2 || 'error' in n3) {
        malformed = true;
        continue;
      }
      counts[row.coId] = { n1: n1.value, n2: n2.value, n3: n3.value };
    }
    const { results, warnings } = step8IndirectAttainment(
      cos.map((co) => co.id),
      counts,
      responseFloor,
    );
    return { byCo: new Map(results.map((r) => [r.coId, r])), warnings, malformed };
  }, [draft, cos, responseFloor]);

  const save = () =>
    startTransition(async () => {
      const result = await saveIndirectFeedbackAction(courseId, draft);
      setErrors(result.errors ?? (result.error ? [result.error] : []));
      setMessage(result.ok ? (result.message ?? 'Saved.') : null);
      if (result.ok) setDirty(false);
    });

  const cell = 'border border-gray-300 px-1 py-0.5';
  const numInput = 'w-20 border-0 px-1 py-1 text-right disabled:bg-gray-100';

  return (
    <div className="space-y-3 max-w-4xl">
      <div>
        <h2 className="font-medium">Student feedback on the course outcomes</h2>
        <p className="text-xs text-gray-600">
          For each outcome, how many students gave each rating on the 3-point scale. Enter the totals from the
          feedback form, not individual responses. The indirect attainment is{' '}
          <span className="font-mono">(1×rated 1 + 2×rated 2 + 3×rated 3) ÷ responses</span>, and it contributes the
          final tenth of each outcome&apos;s attainment.
        </p>
      </div>

      <table className="w-full bg-white border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className={`${cell} w-20`}>Outcome</th>
            <th className={cell}>Statement</th>
            <th className={`${cell} w-24 text-right`}>Rated 1</th>
            <th className={`${cell} w-24 text-right`}>Rated 2</th>
            <th className={`${cell} w-24 text-right`}>Rated 3</th>
            <th className={`${cell} w-24 text-right`}>Responses</th>
            <th className={`${cell} w-28 text-right`}>Indirect</th>
          </tr>
        </thead>
        <tbody>
          {cos.map((co) => {
            const row = draft.find((r) => r.coId === co.id) ?? { coId: co.id, n1: '', n2: '', n3: '' };
            const result = preview.byCo.get(co.id);
            const responses = result?.responses ?? 0;
            const short = responseFloor > 0 && responses > 0 && responses < responseFloor;
            return (
              <tr key={co.id}>
                <td className={`${cell} font-medium`}>{co.code}</td>
                <td className={`${cell} text-xs text-gray-700`}>{co.statement}</td>
                {(['n1', 'n2', 'n3'] as const).map((field) => (
                  <td className={cell} key={field}>
                    <input
                      value={row[field]}
                      disabled={!canEdit}
                      onChange={(e) => update(co.id, field, e.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                      className={numInput}
                      aria-label={`${co.code} rated ${field.slice(1)}`}
                    />
                  </td>
                ))}
                <td className={`${cell} text-right tabular-nums`}>
                  {responses}
                  {short ? (
                    <span className="text-amber-700" title={`Fewer than the ${responseFloor} responses required`}>
                      {' '}
                      ⚠
                    </span>
                  ) : null}
                </td>
                <td className={`${cell} text-right tabular-nums font-medium`}>
                  {formatIndirect(result?.value ?? null)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="text-xs text-gray-600">
        Leave an outcome blank if no feedback was collected for it. That is recorded as <b>no feedback</b>, not as a
        score of zero: its indirect value stays absent and the report says the figure is direct-only. A zero would
        wrongly claim students rated the outcome at the bottom of the scale.
        {responseFloor > 0 ? ` Fewer than ${responseFloor} responses is flagged for review.` : null}
      </p>

      {preview.warnings.length > 0 ? (
        <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
          {preview.warnings.map((warning, i) => (
            <li key={i}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

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
            disabled={!dirty || pending || preview.malformed}
            className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save feedback'}
          </button>
          {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          {preview.malformed ? <span className="text-xs text-red-700">Whole numbers only.</span> : null}
          {message ? <span className="text-xs text-green-800">{message}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500">Read-only.</p>
      )}
    </div>
  );
}

/** Exported for the page's empty state. */
export const hasAnyResponses = (rows: readonly IndirectCounts[]): boolean =>
  rows.some((counts) => responsesOf(counts) > 0);
