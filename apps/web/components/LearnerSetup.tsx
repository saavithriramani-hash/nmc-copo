'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  saveLearnerBandsAction,
  saveLearnerCriteriaAction,
  seedLearnerCriteriaAction,
  type CriterionInput,
} from '@/actions/learners';

/**
 * What a programme rates its students on, and where the categories fall
 * (CR-8). The HoD's setup for the slow/advanced learner report.
 *
 * Both halves are deliberately editable rather than built in. The five
 * criteria in the college's filed workbook are the Mathematics
 * department's own, and the classification it applies has no rule behind
 * it at all — the label is typed by hand there, and the same score of
 * 84.6 appears as both "SL" and "AL" in one sheet. A stated table is the
 * point of moving it here.
 */

export function LearnerCriteriaEditor({
  programmeId,
  initial,
  anyRatings,
}: {
  programmeId: string;
  initial: (CriterionInput & { id: string; ratings: number })[];
  anyRatings: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = (index: number, patch: Partial<CriterionInput>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(false);
  };

  const save = () => {
    setError(null);
    start(async () => {
      const result = await saveLearnerCriteriaAction(
        programmeId,
        rows.map((r) => ({ ...(r.id.startsWith('new:') ? {} : { id: r.id }), label: r.label, maxScore: r.maxScore, derived: r.derived })),
      );
      if (result.error) setError(result.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  const seed = () => {
    setError(null);
    start(async () => {
      const result = await seedLearnerCriteriaAction(programmeId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const total = rows.reduce((sum, r) => sum + (Number.isFinite(r.maxScore) ? r.maxScore : 0), 0);

  if (initial.length === 0 && rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700 max-w-3xl">
          Nothing is rated yet. The college&apos;s workbook uses five criteria, each out of 20 — four the teacher
          judges and one derived from the marks — but they are this department&apos;s choice, not a fixed list.
        </p>
        <div className="flex gap-2">
          <button
            onClick={seed}
            disabled={pending}
            className="border border-gray-300 rounded px-3 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {pending ? 'Adding…' : 'Add the standard five'}
          </button>
          <button
            onClick={() => setRows([{ id: `new:${Date.now()}`, label: '', maxScore: 20, derived: false, ratings: 0 }])}
            className="border border-gray-300 rounded px-3 py-1 text-sm bg-white hover:bg-gray-50"
          >
            Start from nothing
          </button>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <table className="bg-white border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1 w-80">Criterion</th>
            <th className="border border-gray-300 px-2 py-1 w-24 text-right">Out of</th>
            <th className="border border-gray-300 px-2 py-1 w-40">Source</th>
            <th className="border border-gray-300 px-2 py-1 w-24 text-right">Ratings</th>
            <th className="border border-gray-300 px-2 py-1 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="border border-gray-300 p-0">
                <input
                  value={row.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  aria-label={`Criterion ${index + 1} name`}
                  className="w-full px-2 py-1 outline-none"
                />
              </td>
              <td className="border border-gray-300 p-0">
                <input
                  value={String(row.maxScore)}
                  inputMode="decimal"
                  onChange={(e) => update(index, { maxScore: Number(e.target.value) })}
                  aria-label={`${row.label || `Criterion ${index + 1}`} maximum`}
                  className="w-full px-2 py-1 text-right tabular-nums outline-none"
                />
              </td>
              <td className="border border-gray-300 px-2 py-1">
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={row.derived}
                    onChange={(e) => update(index, { derived: e.target.checked })}
                  />
                  from the marks
                </label>
              </td>
              <td className="border border-gray-300 px-2 py-1 text-right tabular-nums text-gray-600">
                {row.derived ? '—' : row.ratings}
              </td>
              <td className="border border-gray-300 px-2 py-1 text-center">
                <button
                  onClick={() => {
                    setRows((current) => current.filter((_, i) => i !== index));
                    setSaved(false);
                  }}
                  disabled={row.ratings > 0}
                  title={row.ratings > 0 ? 'This criterion already carries ratings and cannot be removed.' : 'Remove'}
                  className="text-xs text-red-700 hover:underline disabled:text-gray-400 disabled:no-underline"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          <tr className="font-medium bg-gray-50">
            <td className="border border-gray-300 px-2 py-1">Total obtainable</td>
            <td className="border border-gray-300 px-2 py-1 text-right tabular-nums">{total}</td>
            <td className="border border-gray-300 px-2 py-1" colSpan={3}></td>
          </tr>
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRows((c) => [...c, { id: `new:${Date.now()}`, label: '', maxScore: 20, derived: false, ratings: 0 }])}
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white hover:bg-gray-50"
        >
          Add criterion
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="border border-blue-700 bg-blue-700 text-white rounded px-3 py-1 text-sm hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save criteria'}
        </button>
        {saved ? <span className="text-sm text-green-800">Saved.</span> : null}
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
      </div>

      {anyRatings ? (
        <p className="text-xs text-amber-800 max-w-3xl">
          Ratings already exist against these criteria. Renaming one keeps its ratings; a criterion that carries any
          cannot be removed, so a term&apos;s judgements are never discarded to satisfy this form. Changing a maximum
          does <strong>not</strong> rescale what has been entered.
        </p>
      ) : null}
      <p className="text-xs text-gray-600 max-w-3xl">
        Exactly one criterion may be <em>derived from the marks</em> — the workbook&apos;s &ldquo;Weightage · CIA and
        semester&rdquo;. It is computed as the student&apos;s total marks over the marks their papers allot, scaled to
        its maximum, and cannot be typed.
      </p>
    </div>
  );
}

export function LearnerBandsEditor({
  programmeId,
  initial,
  source,
}: {
  programmeId: string;
  initial: { lowerPercent: number; category: string }[];
  source: 'programme' | 'institution' | 'default';
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const run = (bands: { lowerPercent: number; category: string }[] | null) => {
    setError(null);
    start(async () => {
      const result = await saveLearnerBandsAction(programmeId, bands);
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const sourceLabel =
    source === 'programme'
      ? 'set for this programme'
      : source === 'institution'
        ? 'inherited from the institution'
        : 'the built-in default — nothing is configured';

  if (!open) {
    return (
      <p className="text-xs text-gray-600">
        Categories: {[...rows].sort((a, b) => b.lowerPercent - a.lowerPercent).map((r) => `${r.category} ≥ ${r.lowerPercent}`).join(' · ')} —{' '}
        {sourceLabel}.{' '}
        <button onClick={() => setOpen(true)} className="text-blue-700 hover:underline">
          Change
        </button>
      </p>
    );
  }

  return (
    <div className="border border-gray-300 rounded bg-white p-3 space-y-2 max-w-xl">
      <h3 className="font-medium text-sm">Category bands</h3>
      <p className="text-xs text-gray-600">
        Each band names the score at which it starts, as a percentage of the obtainable total. One must start at 0, so
        that every score lands somewhere and no student is left unlabelled.
      </p>
      <table className="border-collapse text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td className="border border-gray-300 p-0">
                <input
                  value={row.category}
                  aria-label={`Band ${index + 1} name`}
                  onChange={(e) =>
                    setRows((c) => c.map((r, i) => (i === index ? { ...r, category: e.target.value } : r)))
                  }
                  className="w-48 px-2 py-1 outline-none"
                />
              </td>
              <td className="border border-gray-300 px-1 text-xs text-gray-500">starts at</td>
              <td className="border border-gray-300 p-0">
                <input
                  value={String(row.lowerPercent)}
                  inputMode="decimal"
                  aria-label={`Band ${index + 1} starting score`}
                  onChange={(e) =>
                    setRows((c) => c.map((r, i) => (i === index ? { ...r, lowerPercent: Number(e.target.value) } : r)))
                  }
                  className="w-20 px-2 py-1 text-right tabular-nums outline-none"
                />
              </td>
              <td className="border border-gray-300 px-2 text-center">
                <button
                  onClick={() => setRows((c) => c.filter((_, i) => i !== index))}
                  className="text-xs text-red-700 hover:underline"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRows((c) => [...c, { lowerPercent: 0, category: '' }])}
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white hover:bg-gray-50"
        >
          Add band
        </button>
        <button
          onClick={() => run(rows)}
          disabled={pending}
          className="border border-blue-700 bg-blue-700 text-white rounded px-3 py-1 text-sm hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save bands'}
        </button>
        <button
          onClick={() => run(null)}
          disabled={pending || source !== 'programme'}
          title="Fall back to the institution's table, then to the built-in default"
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Clear override
        </button>
        <button onClick={() => setOpen(false)} className="text-sm text-gray-600 hover:underline px-2">
          Cancel
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
