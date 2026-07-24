'use client';

import { useActionState } from 'react';
import { loginAction } from '@/actions/auth';

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form action={formAction} className="w-80 bg-white border border-gray-300 rounded p-6 space-y-4">
        <div>
          <h1 className="text-base font-semibold">CO-PO Attainment</h1>
          <p className="text-xs text-gray-600">Nehru Memorial College (Autonomous)</p>
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
    </main>
  );
}
