'use client';

import { useState, useTransition } from 'react';
import {
  deleteBatchAction,
  deleteDepartmentAction,
  deleteProgrammeAction,
  renameBatchAction,
  renameDepartmentAction,
  renameProgrammeAction,
  type StructureResult,
} from '@/actions/structure';
import { deletionSummary } from '@/lib/structureAdmin';

export type StructureKind = 'department' | 'programme' | 'batch';

/**
 * Dispatched with a switch rather than a lookup table: imported server
 * actions are client references that are not populated at module
 * evaluation time, so building a `Record` of them at module scope
 * captures undefined. Calling them directly keeps the reference live.
 */
function rename(kind: StructureKind, id: string, name: string): Promise<StructureResult> {
  switch (kind) {
    case 'department':
      return renameDepartmentAction(id, name);
    case 'programme':
      return renameProgrammeAction(id, name);
    case 'batch':
      return renameBatchAction(id, name);
  }
}

function remove(kind: StructureKind, id: string): Promise<StructureResult> {
  switch (kind) {
    case 'department':
      return deleteDepartmentAction(id);
    case 'programme':
      return deleteProgrammeAction(id);
    case 'batch':
      return deleteBatchAction(id);
  }
}

/**
 * Rename and delete for one structure row (FR-1). Deliberately plain:
 * explicit buttons, a two-step confirmation rather than a browser
 * confirm() dialog, and no hidden gestures — the same interaction rules
 * the mark grid and the matrix follow.
 *
 * Deletion refuses server-side while anything references the row; this
 * component simply shows what came back. It never predicts the answer,
 * so the button is never disabled on a guess.
 */
export function StructureControls({
  kind,
  id,
  name,
  outcomeCount = 0,
}: {
  kind: StructureKind;
  id: string;
  name: string;
  /** Programmes only: PO/PSO definitions removed with it, disclosed up front. */
  outcomeCount?: number;
}) {
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirming'>('idle');
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setMode('idle');
    setError(null);
    setDraft(name);
  };

  const submitRename = () =>
    startTransition(async () => {
      const result = await rename(kind, id, draft);
      if (result.error) setError(result.error);
      else reset();
    });

  const submitDelete = () =>
    startTransition(async () => {
      const result = await remove(kind, id);
      if (result.error) {
        setError(result.error);
        setMode('idle');
      } else reset();
    });

  if (mode === 'renaming') {
    return (
      <div className="space-y-1">
        <div className="flex gap-1 items-center">
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') reset();
            }}
            className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 min-w-0"
            aria-label={`New name for ${name}`}
          />
          <button
            type="button"
            onClick={submitRename}
            disabled={pending}
            className="text-xs bg-blue-700 text-white rounded px-2 py-1 hover:bg-blue-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={reset} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">
            Cancel
          </button>
        </div>
        {error ? <p className="text-xs text-red-700">{error}</p> : null}
      </div>
    );
  }

  if (mode === 'confirming') {
    return (
      <div className="space-y-1 border border-red-300 bg-red-50 rounded p-2">
        <p className="text-xs text-red-900">{deletionSummary(kind, name, { outcomes: outcomeCount })}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={submitDelete}
            disabled={pending}
            className="text-xs bg-red-700 text-white rounded px-2 py-1 hover:bg-red-800 disabled:opacity-50"
          >
            {pending ? 'Deleting…' : `Yes, delete ${kind}`}
          </button>
          <button type="button" onClick={reset} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode('renaming');
          }}
          className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode('confirming');
          }}
          className="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100 text-red-700"
        >
          Delete
        </button>
      </div>
      {error ? <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p> : null}
    </div>
  );
}
