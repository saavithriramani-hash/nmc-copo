'use client';

import { useActionState } from 'react';
import { changePasswordAction } from '@/actions/auth';

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(changePasswordAction, null);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form action={formAction} className="w-96 bg-white border border-gray-300 rounded p-6 space-y-4">
        <div>
          <h1 className="text-base font-semibold">Set a new password</h1>
          <p className="text-xs text-gray-600">
            Your password must be changed before you continue. At least 10 characters.
          </p>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Current (temporary) password</span>
          <input name="currentPassword" type="password" autoComplete="current-password" required autoFocus className="w-full border border-gray-300 rounded px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">New password</span>
          <input name="newPassword" type="password" autoComplete="new-password" required minLength={10} className="w-full border border-gray-300 rounded px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Repeat new password</span>
          <input name="confirm" type="password" autoComplete="new-password" required minLength={10} className="w-full border border-gray-300 rounded px-2 py-1.5" />
        </label>
        {state?.error ? <p className="text-xs text-red-700">{state.error}</p> : null}
        <button type="submit" disabled={pending} className="w-full bg-blue-700 text-white rounded py-1.5 font-medium hover:bg-blue-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Change password and continue'}
        </button>
      </form>
    </main>
  );
}
