'use client';

import { useActionState, useState } from 'react';
import {
  createUserAction,
  grantRoleAction,
  resetPasswordAction,
  revokeRoleAction,
  setActiveAction,
  type ActionResult,
} from '@/actions/users';
import { ROLE_CAPABILITIES, ROLE_KINDS, ROLE_LABELS, scopeFor } from '@/lib/userAdmin';
import type { RoleKindValue } from '@copo/auth';

export interface RoleView {
  id: string;
  kind: RoleKindValue;
  scopeLabel: string | null;
  window: string;
  inForce: boolean;
}
export interface UserView {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  identityProvider: string;
  isSelf: boolean;
  roles: RoleView[];
}
export interface ScopeOption {
  id: string;
  label: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** The one-time credential panel. Deliberately loud: it cannot be re-shown. */
function CredentialPanel({ result }: { result: ActionResult }) {
  if (!('temporaryPassword' in result)) return null;
  return (
    <div className="border-2 border-amber-500 bg-amber-50 rounded p-3 space-y-1">
      <p className="font-semibold text-amber-900">Temporary password for {result.fullName}</p>
      <p className="text-xs text-amber-900">{result.email}</p>
      <p className="font-mono text-lg select-all bg-white border border-amber-300 rounded px-2 py-1 inline-block">
        {result.temporaryPassword}
      </p>
      <p className="text-xs text-amber-900">{result.note}</p>
    </div>
  );
}

function Feedback({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  if ('error' in result) {
    return <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{result.error}</p>;
  }
  if ('message' in result) return <p className="text-xs text-green-800">{result.message}</p>;
  return null;
}

function CreateUser() {
  const [result, action, pending] = useActionState(createUserAction, null);
  return (
    <section className="bg-white border border-gray-300 rounded p-4 space-y-3">
      <div>
        <h2 className="font-medium">Add an account</h2>
        <p className="text-xs text-gray-600">
          There is no self-registration (§2.1). You create the account, hand over the temporary password in person,
          and the holder must change it at first sign-in. A new account has no roles and can therefore see nothing
          until you grant one.
        </p>
      </div>
      <form action={action} className="flex flex-wrap gap-2 items-end">
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Full name</span>
          <input name="fullName" required className="border border-gray-300 rounded px-2 py-1.5 w-64" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">College email address</span>
          <input name="email" type="email" required className="border border-gray-300 rounded px-2 py-1.5 w-72" />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <Feedback result={result} />
      {result ? <CredentialPanel result={result} /> : null}
    </section>
  );
}

function GrantRole({ user, departments }: { user: UserView; departments: ScopeOption[] }) {
  const [result, action, pending] = useActionState(grantRoleAction, null);
  const [kind, setKind] = useState<RoleKindValue>('FACULTY');
  const scope = scopeFor(kind);
  const options = scope === 'department' ? departments : [];

  return (
    <div className="space-y-1">
      <form action={action} className="flex flex-wrap gap-2 items-end">
        <input type="hidden" name="userId" value={user.id} />
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Role</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as RoleKindValue)}
            className="border border-gray-300 rounded px-2 py-1"
          >
            {ROLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ROLE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        {scope === 'none' ? (
          <p className="text-xs text-gray-500 pb-2 max-w-xs">Institution-wide — no department or programme.</p>
        ) : (
          <label className="block">
            <span className="block text-xs text-gray-600 mb-1">
              {scope === 'department' ? 'Department' : 'Programme'}
            </span>
            <select name="scopeId" required className="border border-gray-300 rounded px-2 py-1 max-w-xs">
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">In force from</span>
          <input
            name="effectiveFrom"
            type="date"
            defaultValue={today()}
            className="border border-gray-300 rounded px-2 py-1"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
        >
          {pending ? 'Granting…' : 'Grant role'}
        </button>
      </form>
      <p className="text-xs text-gray-500">{ROLE_CAPABILITIES[kind]}</p>
      <Feedback result={result} />
    </div>
  );
}

function RoleList({ user }: { user: UserView }) {
  const [result, action, pending] = useActionState(revokeRoleAction, null);
  const inForce = user.roles.filter((r) => r.inForce);
  const ended = user.roles.filter((r) => !r.inForce);

  return (
    <div className="space-y-1">
      {inForce.length === 0 ? (
        <p className="text-xs text-gray-500">
          No role in force — this account can sign in but will see nothing.
        </p>
      ) : (
        <ul className="space-y-1">
          {inForce.map((role) => (
            <li key={role.id} className="flex items-center gap-2 flex-wrap">
              <span className="text-sm">
                <span className="font-medium">{ROLE_LABELS[role.kind]}</span>
                {role.scopeLabel ? <span className="text-gray-600"> — {role.scopeLabel}</span> : null}
                <span className="text-xs text-gray-500"> ({role.window})</span>
              </span>
              <form action={action} className="inline">
                <input type="hidden" name="roleId" value={role.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="text-xs border border-gray-300 rounded px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-50"
                >
                  End
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {ended.length > 0 ? (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">Past assignments ({ended.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {ended.map((role) => (
              <li key={role.id}>
                {ROLE_LABELS[role.kind]}
                {role.scopeLabel ? ` — ${role.scopeLabel}` : ''} ({role.window})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <Feedback result={result} />
    </div>
  );
}

function AccountControls({ user }: { user: UserView }) {
  const [resetResult, resetAction, resetPending] = useActionState(resetPasswordAction, null);
  const [activeResult, activeAction, activePending] = useActionState(setActiveAction, null);

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <form action={resetAction}>
          <input type="hidden" name="userId" value={user.id} />
          <button
            type="submit"
            disabled={resetPending}
            className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
          >
            {resetPending ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
        {user.isSelf ? null : (
          <form action={activeAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="activate" value={user.isActive ? 'false' : 'true'} />
            <button
              type="submit"
              disabled={activePending}
              className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
            >
              {user.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </form>
        )}
      </div>
      <Feedback result={resetResult} />
      {resetResult ? <CredentialPanel result={resetResult} /> : null}
      <Feedback result={activeResult} />
    </div>
  );
}

export function UserAdmin({ users, departments }: { users: UserView[]; departments: ScopeOption[] }) {
  return (
    <div className="space-y-6">
      <CreateUser />

      <table className="w-full bg-white border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-2 py-1 w-64">Account</th>
            <th className="border border-gray-300 px-2 py-1 w-80">Roles in force</th>
            <th className="border border-gray-300 px-2 py-1">Grant a role</th>
            <th className="border border-gray-300 px-2 py-1 w-48">Account</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={user.isActive ? '' : 'bg-gray-50 text-gray-500'}>
              <td className="border border-gray-300 px-2 py-1 align-top">
                <div className="font-medium">
                  {user.fullName}
                  {user.isSelf ? <span className="text-xs font-normal text-blue-700"> (you)</span> : null}
                </div>
                <div className="text-xs text-gray-600">{user.email}</div>
                <div className="text-xs text-gray-500">
                  {user.isActive ? 'Active' : 'Deactivated'}
                  {user.mustChangePassword ? ' · must change password' : ''}
                  {user.identityProvider !== 'LOCAL' ? ` · ${user.identityProvider}` : ''}
                </div>
              </td>
              <td className="border border-gray-300 px-2 py-1 align-top">
                <RoleList user={user} />
              </td>
              <td className="border border-gray-300 px-2 py-1 align-top">
                <GrantRole user={user} departments={departments} />
              </td>
              <td className="border border-gray-300 px-2 py-1 align-top">
                <AccountControls user={user} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
