'use client';

import { useActionState, useState } from 'react';
import { loginAction } from '@/actions/auth';
import { AttainmentMotif } from '@/components/AttainmentMotif';
import { Letterhead } from '@/components/Letterhead';

/**
 * Sign in.
 *
 * Two panes — the college on the left, the form on the right — but in the
 * application's own palette, not a design of its own: the page ground is
 * the `bg-gray-50` every other screen sits on, the card is the same white
 * on `border-gray-300` as every panel inside, and the button is the
 * shared blue-700 primary rather than a dark pill. Somebody signing in
 * should not arrive somewhere that looks like a different product.
 *
 * Three things a conventional sign-in page carries are deliberately
 * absent, because each would advertise something this application does
 * not do: "Log in with Google" (SSO is Phase 3), "Remember for 30 days"
 * (no such setting), and "Sign Up" (accounts are created by the system
 * administrator — the access-control model, not a gap).
 *
 * The password reveal IS here: it needs no backend, and it catches a
 * mistyped password on the one screen where the mistake costs a
 * locked-out user a telephone call.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const [revealed, setRevealed] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-4xl bg-white border border-gray-300 rounded overflow-hidden grid md:grid-cols-2">
        {/* ── the college ── */}
        <aside className="bg-gray-100 border-b md:border-b-0 md:border-r border-gray-300 p-8 flex flex-col items-center justify-center gap-8">
          <div className="bg-white border border-gray-300 rounded p-4 flex justify-center">
            <Letterhead />
          </div>
          {/*
            Hidden below `md`: on a phone the form is what the reader came
            for, and a decorative panel that pushes it below the fold is
            an obstacle.
          */}
          <AttainmentMotif className="hidden md:block w-full max-w-[16rem] h-auto" />
        </aside>

        {/* ── the form ── */}
        <section className="p-8 lg:p-10 flex flex-col justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
            <p className="text-sm text-gray-600 mt-1">Please enter your details</p>
          </div>

          <form action={formAction} className="mt-8 space-y-4">
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
              <span className="relative block">
                <input
                  name="password"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="w-full border border-gray-300 rounded px-2 py-1.5 pr-9"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((r) => !r)}
                  // The label states the ACTION, not the state: a screen
                  // reader announcing "password visible" cannot be acted
                  // on, whereas "show password" can.
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                  aria-pressed={revealed}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-800 rounded"
                >
                  <EyeIcon crossed={revealed} />
                </button>
              </span>
            </label>

            {state?.error ? (
              <p role="alert" className="text-sm text-red-700">
                {state.error}
              </p>
            ) : null}

            {/* The shared primary button, to the letter — see any other form. */}
            <button
              type="submit"
              disabled={pending}
              className="w-full bg-blue-700 text-white rounded py-1.5 font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-xs text-gray-500 mt-6 text-center leading-relaxed">
            Accounts are created by the system administrator.
            <br />
            Forgotten your password? Ask the administrator for a reset.
          </p>

          {/*
            The development credit, and the only place it appears. The
            sign-in page is the one screen with room for it: every screen
            behind it is a working surface where a standing line of chrome
            would take space a table wants.
          */}
          <p className="text-xs text-gray-500 mt-6 text-center">
            Developed by the Curriculum Development Cell
          </p>
        </section>
      </div>
    </main>
  );
}

/** Outline eye, struck through when the password is showing. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.75" />
      {crossed ? <path d="M4 20 20 4" /> : null}
    </svg>
  );
}
