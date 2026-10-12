'use client';

import { useState, useTransition } from 'react';

/**
 * One "Delete"/"Remove" button with a two-step confirmation (CR-9) —
 * the same interaction as StructureControls: an explicit second button
 * rather than a browser confirm() dialog, and the summary of what goes
 * with the row shown before it happens.
 *
 * The server refuses while recorded work depends on the row; this only
 * shows what came back. It never predicts the answer, so the button is
 * never disabled on a guess.
 */
export function ConfirmRemove({
  action,
  summary,
  label,
  confirmLabel,
  pendingLabel,
}: {
  action: () => Promise<{ ok?: true; error?: string }>;
  /** What will be removed, in a sentence ending "This cannot be undone." */
  summary: string;
  label: string;
  confirmLabel: string;
  pendingLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await action();
      setConfirming(false);
      if (result.error) setError(result.error);
    });

  if (confirming) {
    return (
      <div className="space-y-1 border border-red-300 bg-red-50 rounded p-2">
        <p className="text-xs text-red-900">{summary}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="text-xs bg-red-700 text-white rounded px-2 py-1 hover:bg-red-800 disabled:opacity-50"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100 text-red-700"
      >
        {label}
      </button>
      {error ? <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p> : null}
    </div>
  );
}
