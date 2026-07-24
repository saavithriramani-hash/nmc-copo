'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveMarksAction, type MarkCellInput } from '@/actions/marks';
import { parseMarkCell } from '@/lib/marks';

export interface GridStudent {
  enrolmentId: string;
  registerNumber: string;
  studentName: string;
}
export interface GridColumn {
  itemId: string;
  label: string;
  maxMark: number;
  sectionName: string | null;
}
export interface GridMark {
  enrolmentId: string;
  itemId: string;
  value: number | null;
}

const key = (enrolmentId: string, itemId: string) => `${enrolmentId}::${itemId}`;
const canonical = (value: number | null): string => (value === null ? '' : String(value));

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * Mark entry grid (FR-11) — students down, items across.
 *
 *  - Full keyboard nav: arrows move (Left/Right cross cells at the input
 *    edges so mid-value editing still works), Enter/Down go down, Tab
 *    across. No mouse needed.
 *  - Blank ≠ zero, visibly: an empty cell (did not attempt) is hatched and
 *    shows a faint dot; a real 0 shows "0". Clear a cell (Delete/Backspace)
 *    to mark did-not-attempt; type 0 for attempted-scored-nothing.
 *  - Per-cell validation against the item maximum, shown immediately (red
 *    ring); invalid cells are never saved.
 *  - Incremental autosave (debounced) of only the changed cells, through
 *    the indexed bulk-upsert path. Edits persist to localStorage on every
 *    keystroke, so a dropped connection or a reload never loses a screen
 *    of work — they are restored and re-saved.
 *  - An unambiguous status line: Saved ✓ / Saving… / Unsaved (retrying) /
 *    N invalid.
 */
export function MarkGrid({
  assessmentId,
  students,
  columns,
  initial,
  canEdit,
}: {
  assessmentId: string;
  students: GridStudent[];
  columns: GridColumn[];
  initial: GridMark[];
  canEdit: boolean;
}) {
  // Authoritative data lives in refs (no stale closures during autosave);
  // a version counter forces re-render.
  const values = useRef<Map<string, string>>(new Map());
  const saved = useRef<Map<string, number | null>>(new Map());
  const maxByItem = useRef<Map<string, number>>(new Map(columns.map((c) => [c.itemId, c.maxMark])));
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const [, setVersion] = useState(0);
  const [state, setState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [restored, setRestored] = useState(0);
  const rerender = useCallback(() => setVersion((v) => v + 1), []);

  const draftKey = `copo:marks:${assessmentId}`;

  // Seed from the server-provided marks once.
  if (values.current.size === 0 && saved.current.size === 0 && initial.length > 0) {
    for (const mark of initial) {
      saved.current.set(key(mark.enrolmentId, mark.itemId), mark.value);
      values.current.set(key(mark.enrolmentId, mark.itemId), canonical(mark.value));
    }
  }

  const cellState = (enrolmentId: string, itemId: string) => {
    const k = key(enrolmentId, itemId);
    const raw = values.current.get(k) ?? '';
    const max = maxByItem.current.get(itemId) ?? 0;
    const parse = parseMarkCell(raw, max);
    const savedVal = saved.current.has(k) ? (saved.current.get(k) ?? null) : null;
    const invalid = parse.kind === 'invalid';
    const newVal = parse.kind === 'value' ? parse.value : null; // blank/invalid → null candidate
    const dirty = invalid || newVal !== savedVal;
    return { raw, parse, invalid, newVal, dirty };
  };

  const summary = () => {
    let dirty = 0;
    let invalid = 0;
    for (const student of students) {
      for (const column of columns) {
        const cell = cellState(student.enrolmentId, column.itemId);
        if (cell.invalid) invalid += 1;
        else if (cell.dirty) dirty += 1;
      }
    }
    return { dirty, invalid };
  };

  const writeDraft = useCallback(() => {
    const draft: Record<string, string> = {};
    for (const student of students) {
      for (const column of columns) {
        const cell = cellState(student.enrolmentId, column.itemId);
        if (cell.dirty) draft[key(student.enrolmentId, column.itemId)] = cell.raw;
      }
    }
    try {
      if (Object.keys(draft).length === 0) window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* storage full / unavailable — the in-memory edits still stand */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, columns, draftKey]);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    const payload: MarkCellInput[] = [];
    for (const student of students) {
      for (const column of columns) {
        const cell = cellState(student.enrolmentId, column.itemId);
        if (cell.dirty && !cell.invalid) {
          payload.push({ enrolmentId: student.enrolmentId, itemId: column.itemId, value: cell.newVal });
        }
      }
    }
    const { invalid } = summary();
    if (payload.length === 0) {
      setState(invalid > 0 ? 'dirty' : 'saved');
      return;
    }
    savingRef.current = true;
    setState('saving');
    try {
      const result = await saveMarksAction(assessmentId, payload);
      if (result.ok || result.savedAt) {
        for (const cell of payload) saved.current.set(key(cell.enrolmentId, cell.itemId), cell.value);
        setLastSavedAt(result.savedAt ? new Date(result.savedAt) : new Date());
      }
      savingRef.current = false;
      writeDraft();
      const after = summary();
      if (after.dirty > 0) {
        setState('dirty');
        scheduleFlush(300);
      } else {
        setState(after.invalid > 0 ? 'dirty' : 'saved');
      }
    } catch {
      savingRef.current = false;
      setState('error');
      scheduleFlush(4000); // retry after a dropped connection
    }
    rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId, students, columns, writeDraft, rerender]);

  const scheduleFlush = useCallback(
    (delay = 900) => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  const onEdit = (enrolmentId: string, itemId: string, raw: string) => {
    values.current.set(key(enrolmentId, itemId), raw);
    setState('dirty');
    writeDraft();
    scheduleFlush();
    rerender();
  };

  // Restore any unsaved draft from a previous session, then save it.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(draftKey);
      if (!stored) return;
      const draft = JSON.parse(stored) as Record<string, string>;
      let count = 0;
      for (const [k, raw] of Object.entries(draft)) {
        if (values.current.get(k) !== raw) {
          values.current.set(k, raw);
          count += 1;
        }
      }
      if (count > 0) {
        setRestored(count);
        setState('dirty');
        rerender();
        scheduleFlush(500);
      }
    } catch {
      /* ignore malformed draft */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (summary().dirty > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  // ── keyboard navigation ──
  const focusCell = (rowIndex: number, colIndex: number) => {
    const student = students[rowIndex];
    const column = columns[colIndex];
    if (!student || !column) return;
    const input = inputs.current.get(key(student.enrolmentId, column.itemId));
    if (input) {
      input.focus();
      input.select();
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    const target = e.currentTarget;
    switch (e.key) {
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault();
        focusCell(rowIndex + 1, colIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusCell(rowIndex - 1, colIndex);
        break;
      case 'ArrowLeft':
        if (target.selectionStart === 0) {
          e.preventDefault();
          focusCell(rowIndex, colIndex - 1);
        }
        break;
      case 'ArrowRight':
        if (target.selectionStart === target.value.length) {
          e.preventDefault();
          focusCell(rowIndex, colIndex + 1);
        }
        break;
      default:
        break;
    }
  };

  const { dirty, invalid } = summary();
  const hasSections = columns.some((c) => c.sectionName !== null);

  // Group columns by section for the header row.
  const sectionSpans: { name: string | null; span: number }[] = [];
  for (const column of columns) {
    const last = sectionSpans[sectionSpans.length - 1];
    if (last && last.name === column.sectionName) last.span += 1;
    else sectionSpans.push({ name: column.sectionName, span: 1 });
  }

  return (
    <div className="space-y-2">
      <StatusBar state={state} dirty={dirty} invalid={invalid} lastSavedAt={lastSavedAt} canEdit={canEdit} />
      {restored > 0 ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Restored {restored} unsaved edit{restored === 1 ? '' : 's'} from your last session and saved them.
        </p>
      ) : null}

      <div className="overflow-auto border border-gray-300 rounded max-h-[70vh]">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            {hasSections ? (
              <tr>
                <th className="sticky left-0 z-30 bg-gray-100 border border-gray-300 px-2 py-1" colSpan={2}></th>
                {sectionSpans.map((span, i) => (
                  <th key={i} colSpan={span.span} className="bg-gray-100 border border-gray-300 px-2 py-1 text-center">
                    {span.name ?? ''}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              <th className="sticky left-0 z-30 bg-gray-100 border border-gray-300 px-2 py-1 text-left w-32">Register no.</th>
              <th className="sticky left-32 z-30 bg-gray-100 border border-gray-300 px-2 py-1 text-left w-48">Student</th>
              {columns.map((column) => (
                <th key={column.itemId} className="bg-gray-100 border border-gray-300 px-2 py-1 text-center min-w-16" title={`max ${column.maxMark}`}>
                  <div>{column.label}</div>
                  <div className="text-[10px] font-normal text-gray-500">/{column.maxMark}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, rowIndex) => (
              <tr key={student.enrolmentId} className="odd:bg-white even:bg-gray-50">
                <td className="sticky left-0 z-10 bg-inherit border border-gray-300 px-2 py-0.5 font-mono">{student.registerNumber}</td>
                <td className="sticky left-32 z-10 bg-inherit border border-gray-300 px-2 py-0.5 whitespace-nowrap">{student.studentName}</td>
                {columns.map((column, colIndex) => {
                  const cell = cellState(student.enrolmentId, column.itemId);
                  const isBlank = cell.raw.trim() === '';
                  return (
                    <td key={column.itemId} className="border border-gray-300 p-0">
                      <input
                        ref={(el) => {
                          if (el) inputs.current.set(key(student.enrolmentId, column.itemId), el);
                        }}
                        value={cell.raw}
                        readOnly={!canEdit}
                        inputMode="decimal"
                        aria-label={`${student.registerNumber} ${column.label}`}
                        aria-invalid={cell.invalid}
                        onChange={(e) => onEdit(student.enrolmentId, column.itemId, e.target.value)}
                        onKeyDown={(e) => onKeyDown(e, rowIndex, colIndex)}
                        onBlur={() => scheduleFlush(0)}
                        title={cell.invalid && cell.parse.kind === 'invalid' ? cell.parse.reason : isBlank ? 'blank = did not attempt' : ''}
                        placeholder="·"
                        className={[
                          'w-16 text-center py-1 tabular-nums outline-none bg-transparent',
                          cell.invalid ? 'ring-2 ring-red-500 ring-inset text-red-700' : '',
                          isBlank ? 'mark-blank placeholder:text-gray-300' : '',
                          !cell.invalid && !isBlank && cell.dirty ? 'text-blue-800' : '',
                        ].join(' ')}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="mark-blank inline-block w-5 h-4 border border-gray-300 align-middle" /> blank = did not attempt (excluded)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-5 h-4 border border-gray-300 text-center leading-4 bg-white">0</span> zero = attempted, scored nothing (counts)
        </span>
        <span>Keys: arrows / Tab move · Enter next row · Delete clears to blank · type 0 for zero</span>
      </div>
    </div>
  );
}

function StatusBar({
  state,
  dirty,
  invalid,
  lastSavedAt,
  canEdit,
}: {
  state: SaveState;
  dirty: number;
  invalid: number;
  lastSavedAt: Date | null;
  canEdit: boolean;
}) {
  if (!canEdit) return <p className="text-xs text-gray-500">Read-only — marks are entered by the course faculty (DRAFT) or the HoD.</p>;

  let label: string;
  let cls: string;
  if (invalid > 0) {
    label = `${invalid} invalid cell${invalid === 1 ? '' : 's'} — fix to save`;
    cls = 'text-red-700 bg-red-50 border-red-200';
  } else if (state === 'saving') {
    label = 'Saving…';
    cls = 'text-blue-700 bg-blue-50 border-blue-200';
  } else if (state === 'error') {
    label = `Connection problem — ${dirty} unsaved, retrying`;
    cls = 'text-amber-800 bg-amber-50 border-amber-200';
  } else if (dirty > 0) {
    label = `${dirty} unsaved change${dirty === 1 ? '' : 's'}…`;
    cls = 'text-amber-800 bg-amber-50 border-amber-200';
  } else {
    label = lastSavedAt ? `All changes saved · ${lastSavedAt.toLocaleTimeString()}` : 'All changes saved';
    cls = 'text-green-800 bg-green-50 border-green-200';
  }
  return <div className={`inline-block text-xs border rounded px-2 py-1 ${cls}`} role="status" aria-live="polite">{label}</div>;
}
