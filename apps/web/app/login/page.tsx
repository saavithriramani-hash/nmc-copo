'use client';

import { useActionState } from 'react';
import { loginAction } from '@/actions/auth';
import { Letterhead } from '@/components/Letterhead';

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null);

  return (
    // A column rather than a single centred card: the letterhead is a wide
    // banner and shrinking it into a 320px card would make the
    // accreditation line unreadable, which is the part of it that matters
    // to the people filing with NAAC.
    //
    // `justify-center` with `py-10` rather than a fixed vertical centre, so
    // a short laptop screen scrolls instead of clipping the banner.
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 py-10">
      <Letterhead />

      {/*
        w-96 rather than w-80: under a 576px banner a 320px card read as
        two unrelated objects stacked, and the extra 64px also stops the
        "Forgotten password" note breaking across three lines.
      */}
      <form action={formAction} className="w-96 max-w-full bg-white border border-gray-300 rounded p-6 space-y-4">
        <div>
          <h1 className="text-base font-semibold">CO-PO Attainment</h1>
          <p className="text-xs text-gray-600">Course and programme outcome attainment</p>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Email address</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            className="w-full border border-gray-300 rounded px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full border border-gray-300 rounded px-2 py-1.5"
          />
        </label>
        {state?.error ? <p className="text-xs text-red-700">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full bg-blue-700 text-white rounded py-1.5 font-medium hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-gray-500">
          Accounts are created by the system administrator. Forgotten password: ask the administrator for a reset.
        </p>
      </form>

      {/*
        Outside the card and in the page's quietest type: the credit
        belongs to the application, not to the act of signing in, and
        nobody should have to read past it to reach the password field.
      */}
      <footer className="text-xs text-gray-500">Developed by Dr. V. Saavithri</footer>
    </main>
  );
}
