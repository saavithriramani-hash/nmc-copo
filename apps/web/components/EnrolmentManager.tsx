'use client';

import { useMemo, useState, useTransition } from 'react';
import { setEnrolmentAction } from '@/actions/enrolment';

export interface RosterRow {
  rosterEntryId: string;
  registerNumber: string;
  studentName: string;
  enrolled: boolean;
  hasMarks: boolean;
}

/**
 * Draw a course's enrolment from the batch roster (FR-10) — tick students,
 * never type register numbers. A student who already has marks cannot be
 * unenrolled here (it is disabled and explained); the server enforces it too.
 */
export function EnrolmentManager({ courseId, roster }: { courseId: string; roster: RosterRow[] }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(roster.filter((r) => r.enrolled).map((r) => r.rosterEntryId)));
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((r) => r.registerNumber.toLowerCase().includes(needle) || r.studentName.toLowerCase().includes(needle));
  }, [roster, filter]);

  const toggle = (row: RosterRow) => {
    if (row.hasMarks && checked.has(row.rosterEntryId)) return; // cannot unenrol with marks
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(row.rosterEntryId)) next.delete(row.rosterEntryId);
      else next.add(row.rosterEntryId);
      return next;
    });
    setMessage(null);
  };

  const setAll = (on: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      for (const row of visible) {
        if (on) next.add(row.rosterEntryId);
        else if (!row.hasMarks) next.delete(row.rosterEntryId);
      }
      return next;
    });
    setMessage(null);
  };

  const save = () =>
    startTransition(async () => {
      const result = await setEnrolmentAction(courseId, [...checked]);
      if (result.ok) setMessage(`Enrolled ${result.enrolled}, removed ${result.removed}. ${checked.size} students on this course.`);
      else setMessage(result.error ?? 'Could not save.');
    });

  const enrolledCount = checked.size;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by register number or name"
          className="border border-gray-300 rounded px-2 py-1.5 w-72"
        />
        <button type="button" onClick={() => setAll(true)} className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 text-xs">Select all shown</button>
        <button type="button" onClick={() => setAll(false)} className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 text-xs">Clear shown</button>
        <span className="text-xs text-gray-600 ml-auto">{enrolledCount} selected</span>
      </div>

      <div className="max-h-[28rem] overflow-y-auto border border-gray-200 rounded">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-gray-100">
            <tr className="text-left">
              <th className="border border-gray-300 px-2 py-1 w-12"></th>
              <th className="border border-gray-300 px-2 py-1 w-40">Register no.</th>
              <th className="border border-gray-300 px-2 py-1">Name</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.rosterEntryId} className={checked.has(row.rosterEntryId) ? 'bg-blue-50' : ''}>
                <td className="border border-gray-300 px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={checked.has(row.rosterEntryId)}
                    onChange={() => toggle(row)}
                    disabled={row.hasMarks && checked.has(row.rosterEntryId)}
                    title={row.hasMarks ? 'This student has marks recorded and cannot be unenrolled here.' : ''}
                  />
                </td>
                <td className="border border-gray-300 px-2 py-1 font-mono">{row.registerNumber}</td>
                <td className="border border-gray-300 px-2 py-1">
                  {row.studentName}
                  {row.hasMarks ? <span className="text-xs text-gray-500"> · has marks</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save enrolment'}
        </button>
        {message ? <span className="text-xs text-gray-700">{message}</span> : null}
      </div>
    </div>
  );
}
