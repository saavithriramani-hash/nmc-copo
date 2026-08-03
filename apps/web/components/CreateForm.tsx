'use client';

import type { CreateResult } from '@/actions/structure';
import { useServerAction } from './useServerAction';

/**
 * A create form that reports its own failures, in place.
 *
 * The forms this replaces were plain `<form action={serverAction}>`
 * elements that signalled a problem by redirecting to `?error=…`. Two
 * things went wrong with that. In a production build, a server action
 * redirecting to its own route leaves the content area empty — header
 * and navigation and nothing else — so the message never appeared at
 * all. And even when it did, it landed at the top of the page rather
 * than beside the field that caused it.
 *
 * The result is held by `useServerAction`, which renders the message
 * under the form and — importantly — releases the button as soon as the
 * server answers, without waiting for the page refresh that follows.
 * Waiting for that refresh is what left the equivalent buttons on the
 * accounts screen stuck on "Creating…" while the work had in fact been
 * done.
 *
 * The fields are passed in as children so each caller keeps its own
 * inputs; only the submit button and the error line are shared.
 */
export function CreateForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Adding…',
  className = 'flex gap-2',
  buttonClassName = 'border border-gray-300 rounded px-2 py-1 hover:bg-gray-100',
}: {
  action: (prev: CreateResult | null, formData: FormData) => Promise<CreateResult>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  buttonClassName?: string;
}) {
  const { result: state, pending, onSubmit } = useServerAction(action, { resetOnSuccess: true });

  return (
    <div className="space-y-1">
      <form onSubmit={onSubmit} className={className}>
        {children}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending || undefined}
          className={`${buttonClassName} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
      {state?.error ? (
        // role="alert" so a screen reader announces it: the message
        // appears without the page moving, which is otherwise easy to miss.
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
