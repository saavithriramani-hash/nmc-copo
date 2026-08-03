'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * Runs a server action from a form and reports its result — without the
 * button's "working" state depending on the page refresh that follows.
 *
 * This exists because `useActionState` ties the two together. Its
 * `pending` stays true until the action AND the router refresh triggered
 * by `revalidatePath` have both settled, and in a production build that
 * refresh sometimes never settles. The visible effect is a button stuck
 * on "Creating…" for ever, with the work actually done — the account
 * created, the password reset — and the list not showing it until the
 * page is reloaded. Worse, the one-time temporary password is on the
 * other side of that stuck transition, and it is shown exactly once.
 *
 * So the two are separated: `pending` covers the action alone and clears
 * as soon as the server answers, and the refresh is fired afterwards from
 * an effect, outside any transition. A slow or stalled refresh then costs
 * a stale list — recoverable by reloading — instead of a frozen button
 * and a lost credential.
 *
 * The components in this application that never showed the fault
 * (Rename, Delete, the mark importer) already worked this way; this is
 * that pattern, made reusable.
 */
export function useServerAction<T extends { ok?: unknown; error?: string }>(
  action: (prev: T | null, formData: FormData) => Promise<T>,
  options: { resetOnSuccess?: boolean } = {},
) {
  const [result, setResult] = useState<T | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Deliberately NOT inside the transition above: the refresh must not
    // hold the button hostage.
    if (result && !result.error) router.refresh();
  }, [result, router]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const form = event.currentTarget;
    startTransition(async () => {
      const next = await action(null, formData);
      setResult(next);
      // Clear the fields once the row exists, so the same name cannot be
      // submitted twice by someone pressing the button again.
      if (options.resetOnSuccess && !next.error) form.reset();
    });
  };

  return { result, pending, onSubmit, formRef };
}
