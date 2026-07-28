'use client';

import { useState, useTransition } from 'react';
import { setCourseThresholdAction } from '@/actions/courseSettings';
import { formatThresholdPercent, parseThresholdPercent, thresholdExample } from '@/lib/courseThreshold';

/**
 * The course rubric-threshold override (§4.1). Explicit Save, a live
 * worked example so the consequence is visible before committing, and a
 * separate control to drop back to the inherited value.
 */
export function ThresholdEditor({
  courseId,
  override,
  effective,
  sourceLabel,
  inheritedFraction,
}: {
  courseId: string;
  /** The course's own value, or null when it inherits. */
  override: number | null;
  /** The value actually in force after Step 2 resolution. */
  effective: number;
  sourceLabel: string;
  /** What it would fall back to if the override were removed. */
  inheritedFraction: number;
}) {
  const [draft, setDraft] = useState(formatThresholdPercent(override));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseThresholdPercent(draft);
  const previewFraction = 'error' in parsed ? null : (parsed.value ?? inheritedFraction);

  const submit = (value: string) =>
    startTransition(async () => {
      const result = await setCourseThresholdAction(courseId, value);
      setError(result.error ?? null);
      setMessage(result.error ? null : (result.message ?? 'Saved.'));
      if (!result.error) setDraft(value.trim());
    });

  return (
    <div className="bg-white border border-gray-300 rounded p-4 space-y-3 max-w-2xl">
      <div>
        <h2 className="font-medium">Rubric threshold</h2>
        <p className="text-xs text-gray-600">
          A student is counted as having <strong>attained</strong> an item when their mark reaches this share of the
          item&apos;s maximum. It applies to every rubric-scored assessment of this course — internal tests,
          assignments, quizzes and seminars alike. The end-semester examination is unaffected: it is scored by cohort
          bands, which carry their own cut-offs.
        </p>
      </div>

      <p className="text-sm">
        In force: <strong>{formatThresholdPercent(effective)}%</strong>{' '}
        <span className="text-gray-600">— from {sourceLabel}.</span>
      </p>

      <label className="block">
        <span className="block text-xs font-medium text-gray-700 mb-1">
          Threshold for this course (%) — leave empty to inherit
        </span>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit(draft);
            }
          }}
          inputMode="decimal"
          placeholder={`inherits ${formatThresholdPercent(inheritedFraction)}`}
          className="w-40 border border-gray-300 rounded px-2 py-1.5"
        />
      </label>

      {'error' in parsed ? (
        <p className="text-xs text-red-700">{parsed.error}</p>
      ) : previewFraction !== null ? (
        <p className="text-xs text-gray-600">
          {parsed.value === null ? 'Inheriting: ' : 'With this setting: '}
          {thresholdExample(previewFraction, 10)}; {thresholdExample(previewFraction, 5)}.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit(draft)}
          disabled={pending || 'error' in parsed}
          className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save threshold'}
        </button>
        {override !== null ? (
          <button
            type="button"
            onClick={() => submit('')}
            disabled={pending}
            className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
          >
            Remove override
          </button>
        ) : null}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
        {message ? <span className="text-xs text-green-800">{message}</span> : null}
      </div>

      <p className="text-xs text-gray-500">
        Changing this recomputes every figure for this course immediately — nothing derived is stored. Courses already
        locked keep the values in their snapshot. Every change is recorded in the audit log with its previous value,
        and the applied override is shown on the course report.
      </p>
    </div>
  );
}
