'use client';

import { useState, useTransition } from 'react';
import { saveOutcomesAction, type OutcomeRow } from '@/actions/structure';

/**
 * PO/PSO definition editor (FR-2). Dense row editor: Tab moves across,
 * Enter in the last statement adds a row. Explicit Save.
 */
export function OutcomeEditor({ programmeId, initial }: { programmeId: string; initial: OutcomeRow[] }) {
  const [rows, setRows] = useState<OutcomeRow[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (index: number, patch: Partial<OutcomeRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
    setMessage(null);
  };

  const addRow = (kind: 'PO' | 'PSO') => {
    setRows((current) => {
      const count = current.filter((r) => r.kind === kind).length;
      return [...current, { id: null, kind, code: `${kind}${count + 1}`, statement: '' }];
    });
    setDirty(true);
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveOutcomesAction(programmeId, rows);
      if (result.error) setMessage(result.error);
      else {
        setDirty(false);
        setMessage('Saved.');
      }
    });

  return (
    <div className="space-y-2">
      <table className="w-full bg-white border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1 w-20">Kind</th>
            <th className="border border-gray-300 px-2 py-1 w-24">Code</th>
            <th className="border border-gray-300 px-2 py-1">Statement</th>
            <th className="border border-gray-300 px-2 py-1 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? `new-${index}`}>
              <td className="border border-gray-300 px-1 py-0.5">
                <select
                  value={row.kind}
                  onChange={(e) => update(index, { kind: e.target.value as 'PO' | 'PSO' })}
                  className="w-full border-0 py-1"
                >
                  <option value="PO">PO</option>
                  <option value="PSO">PSO</option>
                </select>
              </td>
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
                      addRow(row.kind);
                    }
                  }}
                  placeholder="Outcome statement"
                  className="w-full border-0 px-1 py-1"
                />
              </td>
              <td className="border border-gray-300 px-1 py-0.5 text-center">
                <button type="button" onClick={() => removeRow(index)} className="text-red-700 hover:underline">
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => addRow('PO')} className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">
          + PO
        </button>
        <button type="button" onClick={() => addRow('PSO')} className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">
          + PSO
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="bg-blue-700 text-white rounded px-3 py-1 hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save PO/PSO definitions'}
        </button>
        {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
        {message ? <span className="text-xs text-gray-700">{message}</span> : null}
      </div>
    </div>
  );
}
