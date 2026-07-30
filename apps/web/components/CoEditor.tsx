'use client';

import { useState, useTransition } from 'react';
import { saveCosAction, type CoRow } from '@/actions/cos';
import { BloomSelect } from '@/components/BloomSelect';
import { bloomShortLabel, normaliseBloomLevels, type BloomLevel } from '@/lib/bloom';

/**
 * CO editor (FR-5, extended): dense rows — code, statement, Bloom
 * levels. Enter in the last statement adds the next CO with an auto
 * code. Explicit save.
 *
 * A CO carries one or more Bloom levels, chosen from the multi-select in
 * `BloomSelect`. The levels were previously laid out in full across the
 * row; collapsing them behind a trigger costs a click per edit and buys
 * back most of the width, which goes to the statement — the column
 * faculty actually read.
 */

export function CoEditor({ courseId, initial, canEdit }: { courseId: string; initial: CoRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState<CoRow[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<CoRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
    setMessage(null);
  };

  const addRow = () => {
    setRows((current) => [...current, { id: null, code: `CO${current.length + 1}`, statement: '', bloomLevels: ['Understand'] }]);
    setDirty(true);
  };

  const toggleLevel = (index: number, level: string) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const has = row.bloomLevels.includes(level);
        const next = has ? row.bloomLevels.filter((l) => l !== level) : [...row.bloomLevels, level];
        return { ...row, bloomLevels: normaliseBloomLevels(next) };
      }),
    );
    setDirty(true);
    setMessage(null);
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  };

  const move = (index: number, delta: -1 | 1) => {
    setRows((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return next;
    });
    setDirty(true);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveCosAction(courseId, rows);
      setMessage(result.error ?? 'Saved.');
      if (!result.error) setDirty(false);
    });

  if (!canEdit) {
    return (
      <table className="w-full bg-white border-collapse">
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              <td className="border border-gray-300 px-2 py-1 w-20 font-medium">{row.code}</td>
              <td className="border border-gray-300 px-2 py-1">{row.statement}</td>
              <td className="border border-gray-300 px-2 py-1 w-56">
                {/* The same chips as the editor, minus the affordance —
                    so a read-only viewer and the faculty member editing
                    are looking at the same thing. */}
                <span className="flex flex-wrap gap-0.5">
                  {row.bloomLevels.map((level) => (
                    <span key={level} className="text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded px-1 py-0.5">
                      {bloomShortLabel(level as BloomLevel)}
                    </span>
                  ))}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td className="border border-gray-300 px-2 py-2 text-gray-600">No COs defined.</td></tr>
          ) : null}
        </tbody>
      </table>
    );
  }

  return (
    <div className="space-y-2">
      <table className="w-full bg-white border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1 w-20">Code</th>
            <th className="border border-gray-300 px-2 py-1">Statement</th>
            <th className="border border-gray-300 px-2 py-1 w-48">Bloom levels</th>
            <th className="border border-gray-300 px-2 py-1 w-20">Order</th>
            <th className="border border-gray-300 px-2 py-1 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? `new-${index}`}>
              <td className="border border-gray-300 px-1 py-0.5">
                <input value={row.code} onChange={(e) => update(index, { code: e.target.value })} className="w-full border-0 px-1 py-1" />
              </td>
              <td className="border border-gray-300 px-1 py-0.5">
                <input
                  value={row.statement}
                  onChange={(e) => update(index, { statement: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && index === rows.length - 1) {
                      e.preventDefault();
                      addRow();
                    }
                  }}
                  placeholder="On completing the course, the student can…"
                  className="w-full border-0 px-1 py-1"
                />
              </td>
              {/* `overflow-visible` so the open menu is not clipped by
                  the cell it hangs out of. */}
              <td className="border border-gray-300 px-1 py-1 overflow-visible">
                <BloomSelect
                  code={row.code}
                  selected={row.bloomLevels}
                  onToggle={(level) => toggleLevel(index, level)}
                />
              </td>
              <td className="border border-gray-300 px-1 py-0.5 text-center whitespace-nowrap">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="px-1 disabled:opacity-30" aria-label="move up">↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === rows.length - 1} className="px-1 disabled:opacity-30" aria-label="move down">↓</button>
              </td>
              <td className="border border-gray-300 px-1 py-0.5 text-center">
                <button type="button" onClick={() => removeRow(index)} className="text-red-700 hover:underline">remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <button type="button" onClick={addRow} className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">+ CO</button>
        <button type="button" onClick={save} disabled={!dirty || pending} className="bg-blue-700 text-white rounded px-3 py-1 hover:bg-blue-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save COs'}
        </button>
        {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
        {message ? <span className="text-xs text-gray-700">{message}</span> : null}
      </div>
    </div>
  );
}
