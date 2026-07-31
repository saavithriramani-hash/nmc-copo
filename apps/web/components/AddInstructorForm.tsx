'use client';

import { useState } from 'react';
import { FacultyPicker } from '@/components/FacultyPicker';
import type { FacultyOption } from '@/lib/facultySearch';

/**
 * Assign a faculty member to a course (FR-4 staffing, HoD only).
 *
 * This was a bare email field: you had to already know the address, and
 * a typo produced "No active account with that email" after a round
 * trip. Choosing from the real list removes both failure modes — the
 * only addresses offered are ones that exist, are active, and hold the
 * Faculty role, which is exactly what the server action then re-checks.
 *
 * The server action is unchanged and still reads `email` from FormData;
 * it re-verifies the account and the role, because a client that can
 * post a form can post any address (NFR-10). Nothing here is a
 * permission check — it is a way to avoid typing.
 */
export function AddInstructorForm({
  action,
  options,
}: {
  action: (formData: FormData) => void | Promise<void>;
  options: FacultyOption[];
}) {
  const [selected, setSelected] = useState<FacultyOption | null>(null);
  // Remounting the picker is what clears it. The server action
  // revalidates the page rather than navigating, so React keeps this
  // component mounted and the previous choice would otherwise still be
  // sitting in the box — leaving the HoD to clear it by hand before
  // adding the second of two people.
  const [pickerKey, setPickerKey] = useState(0);

  async function submit(formData: FormData) {
    await action(formData);
    setSelected(null);
    setPickerKey((key) => key + 1);
  }

  if (options.length === 0) {
    return (
      <p className="text-xs text-gray-600">
        Every active Faculty account is already assigned to this course. New accounts are created on the
        administrator’s Accounts &amp; roles screen.
      </p>
    );
  }

  return (
    <form action={submit} className="flex items-start gap-2 max-w-lg">
      <div className="flex-1">
        <FacultyPicker
          key={pickerKey}
          name="email"
          submit="email"
          options={options}
          placeholder="Search faculty by name or email…"
          onSelectedChange={setSelected}
        />
      </div>
      {/* Disabled until a real person is chosen: submitting an empty
          field would only produce a server-side error page. */}
      <button
        type="submit"
        disabled={selected === null}
        className="border border-gray-300 rounded px-2 py-1.5 hover:bg-gray-100 disabled:opacity-50 shrink-0"
      >
        Add faculty
      </button>
    </form>
  );
}
