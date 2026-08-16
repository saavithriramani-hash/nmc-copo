'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveLearnerRatingsAction, type RatingInput } from '@/actions/learners';
import { parseMarkCell } from '@/lib/marks';

export interface RatingStudent {
  enrolmentId: string;
  registerNumber: string;
  fullName: string;
}
export interface RatingCriterion {
  id: string;
  label: string;
  maxScore: number;
  derived: boolean;
}

const key = (enrolmentId: string, criterionId: string) => `${enrolmentId}::${criterionId}`;
const canonical = (value: number | null): string => (value === null ? '' : String(value));

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * The slow/advanced learner rating sheet for one subject (CR-8) —
 * students down, criteria across, on the same autosave pattern as mark
 * entry so faculty meet one grid, not two.
 *
 * The DERIVED column is read-only and computed from the mark ledger. It
 * is shown rather than hidden because the department reads it as one of
 * the five, and because seeing it beside the four judgements is the point
 * — four parts opinion to one part measurement, visibly so.
 *
 * Blank is not zero here either, and it matters more than in mark entry:
 * a criterion left blank leaves the divisor entirely, so a half-filled
 * sheet cannot drag a student towards "slow learner". A typed 0 is a real
 * judgement and counts.
 */
export function LearnerRatingGrid({
  courseId,
  students,
  criteria,
  initial,
  weightage,
  canEdit,
}: {
  courseId: string;
  students: RatingStudent[];
  criteria: RatingCriterion[];
  initial: Record<string, Record<string, number | null>>;
  weightage: Record<string, number | null>;
  canEdit: boolean;
}) {
  const editable = criteria.filter((c) => !c.derived);

  const values = useRef<Map<string, string>>(new Map());
  const saved = useRef<Map<string, number | null>>(new Map());
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const seeded = useRef(false);

  const [, setVersion] = useState(0);
  const [state, setState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const rerender = useCallback(() => setVersion((v) => v + 1), []);

  if (!seeded.current) {
    seeded.current = true;
    for (const [enrolmentId, row] of Object.entries(initial)) {
      for (const [criterionId, score] of Object.entries(row)) {
        saved.current.set(key(enrolmentId, criterionId), score);
        values.current.set(key(enrolmentId, criterionId), canonical(score));
      }
    }
  }

  const cellState = (enrolmentId: string, criterion: RatingCriterion) => {
    const k = key(enrolmentId, criterion.id);
    const raw = values.current.get(k) ?? '';
    const parse = parseMarkCell(raw, criterion.maxScore);
    const savedVal = saved.current.has(k) ? (saved.current.get(k) ?? null) : null;
    const invalid = parse.kind === 'invalid';
    const newVal = parse.kind === 'value' ? parse.value : null;
    return { raw, parse, invalid, newVal, dirty: invalid || newVal !== savedVal };
  };

  const summary = () => {
    let dirty = 0;
    let invalid = 0;
    for (const student of students) {
      for (const criterion of editable) {
        const cell = cellState(student.enrolmentId, criterion);
        if (cell.invalid) invalid += 1;
        else if (cell.dirty) dirty += 1;
      }
    }
    return { dirty, invalid };
  };

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    const payload: RatingInput[] = [];
    for (const student of students) {
      for (const criterion of editable) {
        const cell = cellState(student.enrolmentId, criterion);
        if (cell.dirty && !cell.invalid) {
          payload.push({ enrolmentId: student.enrolmentId, criterionId: criterion.id, score: cell.newVal });
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
      const result = await saveLearnerRatingsAction(courseId, payload);
      if (result.ok || result.savedAt) {
        for (const cell of payload) saved.current.set(key(cell.enrolmentId, cell.criterionId), cell.score);
        setLastSavedAt(result.savedAt ? new Date(result.savedAt) : new Date());
      }
      savingRef.current = false;
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
      scheduleFlush(4000);
    }
    rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, students, criteria, rerender]);

  const scheduleFlush = useCallback(
    (delay = 900) => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  const onEdit = (enrolmentId: string, criterionId: string, raw: string) => {
    values.current.set(key(enrolmentId, criterionId), raw);
    setState('dirty');
    scheduleFlush();
    rerender();
  };

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

  const focusCell = (rowIndex: number, colIndex: number) => {
    const student = students[rowIndex];
    const criterion = editable[colIndex];
    if (!student || !criterion) return;
    const input = inputs.current.get(key(student.enrolmentId, criterion.id));
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

  return (
    <div className="space-y-2">
      <StatusBar state={state} dirty={dirty} invalid={invalid} lastSavedAt={lastSavedAt} canEdit={canEdit} />

      <div className="overflow-auto border border-gray-300 rounded max-h-[70vh]">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="sticky left-0 z-30 bg-gray-100 border border-gray-300 px-2 py-1 text-left w-32">
                Register no.
              </th>
              <th className="sticky left-32 z-30 bg-gray-100 border border-gray-300 px-2 py-1 text-left w-48">Student</th>
              {criteria.map((criterion) => (
                <th
                  key={criterion.id}
                  className="bg-gray-100 border border-gray-300 px-2 py-1 text-center min-w-24 max-w-32"
                >
                  <div className="font-normal text-xs whitespace-normal">{criterion.label}</div>
                  <div className="text-[10px] font-normal text-gray-500">
                    /{criterion.maxScore}
                    {criterion.derived ? ' · from marks' : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, rowIndex) => {
              let colIndex = -1;
              return (
                <tr key={student.enrolmentId} className="odd:bg-white even:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-inherit border border-gray-300 px-2 py-0.5 font-mono">
                    {student.registerNumber}
                  </td>
                  <td className="sticky left-32 z-10 bg-inherit border border-gray-300 px-2 py-0.5 whitespace-nowrap">
                    {student.fullName}
                  </td>
                  {criteria.map((criterion) => {
                    if (criterion.derived) {
                      const value = weightage[student.enrolmentId] ?? null;
                      return (
                        <td
                          key={criterion.id}
                          className="border border-gray-300 px-2 py-0.5 text-center tabular-nums bg-gray-100 text-gray-600"
                          title={
                            value === null
                              ? 'No marks entered for this student, so no weightage can be derived. Not zero — nothing to count.'
                              : 'Derived from the marks; not editable here.'
                          }
                        >
                          {value === null ? '—' : value.toFixed(1)}
                        </td>
                      );
                    }
                    colIndex += 1;
                    const myCol = colIndex;
                    const cell = cellState(student.enrolmentId, criterion);
                    const isBlank = cell.raw.trim() === '';
                    return (
                      <td key={criterion.id} className="border border-gray-300 p-0">
                        <input
                          ref={(el) => {
                            if (el) inputs.current.set(key(student.enrolmentId, criterion.id), el);
                          }}
                          value={cell.raw}
                          readOnly={!canEdit}
                          inputMode="decimal"
                          aria-label={`${student.registerNumber} ${criterion.label}`}
                          aria-invalid={cell.invalid}
                          onChange={(e) => onEdit(student.enrolmentId, criterion.id, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, rowIndex, myCol)}
                          onBlur={() => scheduleFlush(0)}
                          title={
                            cell.invalid && cell.parse.kind === 'invalid'
                              ? cell.parse.reason
                              : isBlank
                                ? 'blank = not rated (leaves the average entirely)'
                                : ''
                          }
                          placeholder="·"
                          className={[
                            'w-full min-w-24 text-center py-1 tabular-nums outline-none bg-transparent',
                            cell.invalid ? 'ring-2 ring-red-500 ring-inset text-red-700' : '',
                            isBlank ? 'mark-blank placeholder:text-gray-300' : '',
                            !cell.invalid && !isBlank && cell.dirty ? 'text-blue-800' : '',
                          ].join(' ')}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="mark-blank inline-block w-5 h-4 border border-gray-300 align-middle" /> blank = not rated
          (leaves the average, never counted as nought)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-5 h-4 border border-gray-300 text-center leading-4 bg-white">0</span> zero = a
          rating of nothing (counts)
        </span>
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
  if (!canEdit) {
    return <p className="text-xs text-gray-500">Read-only — these ratings are entered by the course faculty or the HoD.</p>;
  }

  let label: string;
  let cls: string;
  if (invalid > 0) {
    label = `${invalid} invalid rating${invalid === 1 ? '' : 's'} — fix to save`;
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
  return (
    <div className={`inline-block text-xs border rounded px-2 py-1 ${cls}`} role="status" aria-live="polite">
      {label}
    </div>
  );
}
