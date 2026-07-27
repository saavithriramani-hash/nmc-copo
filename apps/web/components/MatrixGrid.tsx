'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { step1ArticulationWeightages } from '@copo/engine';
import type { PoMatrix } from '@copo/engine';
import { saveMatrixAction, type MatrixCellInput } from '@/actions/matrix';

export interface MatrixCo {
  id: string;
  code: string;
  statement: string;
}
export interface MatrixPo {
  id: string;
  code: string;
  kind: 'PO' | 'PSO';
}

/**
 * The articulation matrix grid (FR-6): COs down, POs/PSOs across, cells
 * taking 1, 2, 3 or blank. Excel-like keys: type 1/2/3 to set and move
 * right; 0, space, Backspace or Delete to clear; arrows and Tab move.
 *
 * The weightage row beneath the columns is computed LIVE by the engine's
 * own Step 1 (`step1ArticulationWeightages`) — the same pure function the
 * attainment computation uses, so what faculty see while typing is by
 * construction what the report will use. Nothing is stored until Save.
 */
export function MatrixGrid({
  courseId,
  cos,
  pos,
  initialCells,
  canEdit,
}: {
  courseId: string;
  cos: MatrixCo[];
  pos: MatrixPo[];
  initialCells: MatrixCellInput[];
  canEdit: boolean;
}) {
  const [cells, setCells] = useState<Map<string, 1 | 2 | 3>>(
    () => new Map(initialCells.map((cell) => [`${cell.coId}|${cell.poId}`, cell.strength])),
  );
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const weightages = useMemo(() => {
    const matrix: PoMatrix = {};
    for (const co of cos) {
      const row: Record<string, 1 | 2 | 3 | null> = {};
      for (const po of pos) row[po.id] = cells.get(`${co.id}|${po.id}`) ?? null;
      matrix[co.id] = row;
    }
    const engineCos = cos.map((co) => ({ id: co.id, statement: co.statement, bloomLevels: [] }));
    const { result } = step1ArticulationWeightages(engineCos, matrix);
    return new Map(result.perPo.map((po) => [po.poId, po.weightage]));
  }, [cells, cos, pos]);

  const setCell = (coId: string, poId: string, value: 1 | 2 | 3 | null) => {
    setCells((current) => {
      const next = new Map(current);
      if (value === null) next.delete(`${coId}|${poId}`);
      else next.set(`${coId}|${poId}`, value);
      return next;
    });
    setDirty(true);
    setMessage(null);
  };

  const focusCell = (rowIndex: number, colIndex: number) => {
    const co = cos[rowIndex];
    const po = pos[colIndex];
    if (!co || !po) return;
    inputRefs.current.get(`${co.id}|${po.id}`)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    const co = cos[rowIndex]!;
    const po = pos[colIndex]!;
    switch (event.key) {
      case '1':
      case '2':
      case '3':
        event.preventDefault();
        setCell(co.id, po.id, Number(event.key) as 1 | 2 | 3);
        focusCell(rowIndex, colIndex + 1);
        return;
      case '0':
      case ' ':
      case 'Backspace':
      case 'Delete':
        event.preventDefault();
        setCell(co.id, po.id, null);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusCell(rowIndex - 1, colIndex);
        return;
      case 'ArrowDown':
      case 'Enter':
        event.preventDefault();
        focusCell(rowIndex + 1, colIndex);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(rowIndex, colIndex - 1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusCell(rowIndex, colIndex + 1);
        return;
      default:
        if (event.key.length === 1) event.preventDefault(); // only 1/2/3/clear keys do anything
    }
  };

  const save = () =>
    startTransition(async () => {
      const payload: MatrixCellInput[] = [];
      for (const [key, strength] of cells) {
        const [coId, poId] = key.split('|') as [string, string];
        payload.push({ coId, poId, strength });
      }
      const result = await saveMatrixAction(courseId, payload);
      setMessage(result.error ?? 'Saved.');
      if (!result.error) setDirty(false);
    });

  const poGroup = pos.filter((po) => po.kind === 'PO');
  const psoGroup = pos.filter((po) => po.kind === 'PSO');
  const ordered = [...poGroup, ...psoGroup];

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="bg-white border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-1 text-left" rowSpan={2}>CO</th>
              {poGroup.length > 0 ? <th className="border border-gray-300 px-2 py-1" colSpan={poGroup.length}>Programme outcomes</th> : null}
              {psoGroup.length > 0 ? <th className="border border-gray-300 px-2 py-1" colSpan={psoGroup.length}>PSOs</th> : null}
            </tr>
            <tr className="bg-gray-100">
              {ordered.map((po) => (
                <th key={po.id} className="border border-gray-300 px-2 py-1 w-14 text-center">{po.code}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cos.map((co, rowIndex) => (
              <tr key={co.id}>
                <td className="border border-gray-300 px-2 py-1 whitespace-nowrap" title={co.statement}>
                  <span className="font-medium">{co.code}</span>
                </td>
                {ordered.map((po, colIndex) => {
                  const value = cells.get(`${co.id}|${po.id}`);
                  return (
                    <td key={po.id} className="border border-gray-300 p-0">
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(`${co.id}|${po.id}`, el);
                        }}
                        value={value ?? ''}
                        readOnly={!canEdit}
                        onKeyDown={canEdit ? (e) => onKeyDown(e, rowIndex, colIndex) : undefined}
                        onChange={() => undefined /* keyboard-managed */}
                        inputMode="numeric"
                        aria-label={`${co.code} to ${po.code}`}
                        className="w-14 text-center py-1 border-0 bg-transparent"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50">
              <td className="border border-gray-300 px-2 py-1 text-xs font-medium">
                Weightage <span className="font-normal text-gray-600">(mean of mapped strengths — engine Step 1, live)</span>
              </td>
              {ordered.map((po) => {
                const weight = weightages.get(po.id);
                return (
                  <td key={po.id} className="border border-gray-300 px-1 py-1 text-center text-xs font-medium">
                    {weight === null || weight === undefined ? '—' : weight.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={!dirty || pending} className="bg-blue-700 text-white rounded px-3 py-1 hover:bg-blue-800 disabled:opacity-50">
            {pending ? 'Saving…' : 'Save matrix'}
          </button>
          {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
          {message ? <span className="text-xs text-gray-700">{message}</span> : null}
          <span className="text-xs text-gray-500">Keys: 1/2/3 set and move right · 0, space or Backspace clear · arrows move</span>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Read-only.</p>
      )}
    </div>
  );
}
