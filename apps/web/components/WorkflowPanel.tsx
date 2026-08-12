'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { EngineWarning } from '@copo/engine';
import { lockCourseAction, returnCourseAction, submitCourseAction, unlockCourseAction } from '@/actions/workflow';

/**
 * The approval workflow controls (FR-16). A course with engine warnings
 * cannot be locked until they are read and acknowledged, and the
 * acknowledgement is tied to the exact warning set by fingerprint — if
 * the marks change in between, the server refuses and asks for a re-read.
 */
export function WorkflowPanel({
  courseId,
  status,
  warnings,
  fingerprint,
  canSubmit,
  canLock,
  canReturn,
  canUnlock,
}: {
  courseId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'LOCKED';
  warnings: EngineWarning[];
  fingerprint: string;
  canSubmit: boolean;
  canLock: boolean;
  canReturn: boolean;
  canUnlock: boolean;
}) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /**
   * Which operation is running, so the button that was pressed can say
   * so. Locking recomputes the course and writes an immutable snapshot;
   * a dimmed button with an unchanged label reads as a frozen page.
   */
  const [busy, setBusy] = useState<'submit' | 'lock' | 'return' | 'unlock' | null>(null);

  const run = (
    kind: 'submit' | 'lock' | 'return' | 'unlock',
    fn: () => Promise<{ ok: boolean; error?: string; version?: number }>,
  ) => {
    setBusy(kind);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.ok) {
          setMessage(
            result.version
              ? `Locked as version ${result.version}.`
              : kind === 'return'
                ? 'Sent back to the course faculty with your comment.'
                : 'Done.',
          );
          setAcknowledged(false);
          setReason('');
          setComment('');
          setReturning(false);
          router.refresh();
        } else {
          setMessage(result.error ?? 'Could not complete.');
        }
      } finally {
        // Cleared even on failure, or the panel stays stuck on "Locking…"
        // with no way back.
        setBusy(null);
      }
    });
  };

  const blocking = warnings.length > 0 && !acknowledged;

  return (
    <div className="border border-gray-300 rounded bg-white p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Status: {status}</span>
        {warnings.length > 0 ? (
          <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 rounded px-2 py-0.5">
            computed with {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-xs bg-green-100 text-green-900 border border-green-300 rounded px-2 py-0.5">no warnings</span>
        )}
      </div>

      {canLock && warnings.length > 0 ? (
        <label className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded p-2">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5" />
          <span>
            I have read the {warnings.length} warning{warnings.length === 1 ? '' : 's'} above and accept them as the
            approved basis for this course&apos;s attainment.
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {canSubmit ? (
          <button
            type="button"
            onClick={() => run('submit', () => submitCourseAction(courseId))}
            disabled={pending}
            className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
          >
            {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
          </button>
        ) : null}

        {canLock ? (
          <button
            type="button"
            onClick={() => run('lock', () => lockCourseAction(courseId, warnings.length > 0 ? fingerprint : null))}
            disabled={pending || blocking}
            title={blocking ? 'Acknowledge the warnings first' : ''}
            className="bg-green-700 text-white rounded px-3 py-1.5 hover:bg-green-800 disabled:opacity-50"
          >
            {busy === 'lock' ? 'Locking and snapshotting…' : 'Approve and lock'}
          </button>
        ) : null}

        {canReturn && !returning ? (
          <button
            type="button"
            onClick={() => setReturning(true)}
            disabled={pending}
            className="border border-amber-400 text-amber-900 bg-amber-50 rounded px-3 py-1.5 hover:bg-amber-100 disabled:opacity-50"
          >
            Send back for changes
          </button>
        ) : null}

        {canUnlock ? (
          <>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for unlocking (recorded)"
              className="border border-gray-300 rounded px-2 py-1.5 w-72"
            />
            <button
              type="button"
              onClick={() => run('unlock', () => unlockCourseAction(courseId, reason))}
              disabled={pending || reason.trim().length < 5}
              className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
            >
              {busy === 'unlock' ? 'Unlocking…' : 'Unlock (creates a new version)'}
            </button>
          </>
        ) : null}
      </div>

      {/*
        The comment is a textarea, not the one-line input the unlock
        reason uses: "recompute Test 2 — Q4 is tagged to CO3 but examines
        CO2, and three students have blanks that should be zeros" is what
        a HoD actually needs to write, and it is the whole point of
        returning rather than telephoning.
      */}
      {canReturn && returning ? (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 space-y-2">
          <label className="block text-sm font-medium" htmlFor="return-comment">
            What needs to change before you can approve this?
          </label>
          <textarea
            id="return-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="e.g. Q4 of Test 2 is tagged to CO3 but examines CO2. Please re-tag and resubmit."
            className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
          />
          <p className="text-xs text-gray-600">
            The course faculty see this on their dashboard, and it is kept with the course as part of how it came to be
            approved. It cannot be edited afterwards.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => run('return', () => returnCourseAction(courseId, comment))}
              disabled={pending || comment.trim().length < 5}
              className="bg-amber-700 text-white rounded px-3 py-1.5 hover:bg-amber-800 disabled:opacity-50"
            >
              {busy === 'return' ? 'Sending back…' : 'Send back for changes'}
            </button>
            <button
              type="button"
              onClick={() => {
                setReturning(false);
                setComment('');
              }}
              disabled={pending}
              className="border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="text-sm text-gray-800 bg-gray-100 border border-gray-200 rounded px-3 py-2">{message}</p> : null}
      {status === 'LOCKED' ? (
        <p className="text-xs text-gray-600">
          Locked. The figures shown come from the immutable snapshot, not a fresh computation. Unlocking returns the
          course to draft; the snapshot is never altered — re-locking writes the next version.
        </p>
      ) : null}
    </div>
  );
}
