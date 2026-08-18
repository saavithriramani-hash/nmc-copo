'use client';

import { useActionState, useState } from 'react';
import { loginAction } from '@/actions/auth';
import { AttainmentMotif } from '@/components/AttainmentMotif';
import { Letterhead } from '@/components/Letterhead';

/**
 * Sign in.
 *
 * A two-pane card on a dark ground: the college on the left, the form on
 * the right. Three things the reference design carries are deliberately
 * NOT here, because each would advertise something this application does
 * not do:
 *
 *  - "Log in with Google". SSO is Phase 3 (§ roles and auth). Local
 *    accounts sit behind an interface designed for it, but the button
 *    would do nothing today.
 *  - "Remember for 30 days". There is no such setting; a checkbox that
 *    changes no behaviour is worse than none.
 *  - "Sign Up". Accounts are created by the system administrator — that
 *    is the access-control model, not an omission.
 *
 * The password reveal IS here: it needs no backend, and it is the one
 * control that saves a mistyped password on a screen where the mistake
 * costs a locked-out user a telephone call.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const [revealed, setRevealed] = useState(false);

  return (
    <main className="min-h-screen bg-slate-900 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl overflow-hidden grid md:grid-cols-2">
        {/* ── the college ── */}
        <aside className="bg-gray-100 p-8 lg:p-10 flex flex-col justify-between gap-10">
          {/*
            On a white card of its own. The banner is stationery artwork
            with its own white ground baked in, so on a grey pane it read
            as a pasted-on rectangle; sitting it deliberately on white
            makes that edge intentional. The typographic fallback takes
            the same card and looks equally at home.
          */}
          <div className="bg-white rounded-lg p-4 shadow-sm flex justify-center">
            <Letterhead />
          </div>
          {/*
            Hidden below `md`: on a phone the form is what the reader came
            for, and a decorative panel that pushes it below the fold is
            an obstacle.
          */}
          <AttainmentMotif className="hidden md:block w-full max-w-xs mx-auto h-auto" />
          <p className="text-xs text-gray-600 leading-relaxed">
            Course and programme outcome attainment, computed from question-wise marks by the college&apos;s own
            ten-step procedure — for NAAC and NBA filing.
          </p>
        </aside>

        {/* ── the form ── */}
        <section className="p-8 lg:p-12 flex flex-col justify-center">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Welcome back</h1>
            <p className="text-sm text-gray-600 mt-1">Please enter your details</p>
          </div>

          <form action={formAction} className="mt-8 space-y-6">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700">Email address</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                // Underlined rather than boxed, following the reference.
                // `bg-transparent` so the field cannot read as a filled
                // box on the white pane.
                className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 text-base focus:border-blue-700 focus:ring-0"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-gray-700">Password</span>
              <span className="relative block">
                <input
                  name="password"
                  type={revealed ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="w-full border-0 border-b border-gray-300 bg-transparent px-0 py-2 pr-10 text-base focus:border-blue-700 focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((r) => !r)}
                  // The label states the ACTION, not the state: a screen
                  // reader announcing "password visible" cannot be acted
                  // on, whereas "show password" can.
                  aria-label={revealed ? 'Hide password' : 'Show password'}
                  aria-pressed={revealed}
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-800 rounded"
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

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-gray-900 text-white rounded-full py-3 font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {pending ? 'Signing in…' : 'Log in'}
            </button>
          </form>

          <p className="text-xs text-gray-500 mt-8 text-center leading-relaxed">
            Accounts are created by the system administrator.
            <br />
            Forgotten your password? Ask the administrator for a reset.
          </p>

          <p className="text-xs text-gray-400 mt-8 text-center">Developed by Dr. V. Saavithri</p>
        </section>
      </div>
    </main>
  );
}

/** Outline eye, struck through when the password is showing. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="20"
      height="20"
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
