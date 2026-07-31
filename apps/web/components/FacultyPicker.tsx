'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchFaculty, type FacultyOption } from '@/lib/facultySearch';

/**
 * Type-to-search picker for choosing one faculty member.
 *
 * A college has up to 200 active faculty. A plain <select> of 200 names
 * is unusable — you cannot type more than the first letter, and two
 * people whose names begin alike are indistinguishable without scrolling
 * — and the course details tab was worse still: a bare email field that
 * required you to already know the address.
 *
 * The whole list is sent to the browser and filtered here rather than
 * queried per keystroke. At 200 people that is a few kilobytes, and it
 * buys instant filtering with no debounce, no loading state and no new
 * endpoint to authorise. If the college ever runs to thousands of staff
 * this should become a server search; until then it would be machinery
 * for its own sake.
 *
 * Matching is on name AND email, because staff are looked up both ways —
 * by the name on the timetable, or by the address on a memo.
 */

export type { FacultyOption };

export function FacultyPicker({
  name,
  options,
  submit,
  placeholder = 'Type a name or email…',
  emptyOptionLabel,
  onSelectedChange,
}: {
  /** Form field name the server action reads. */
  name: string;
  options: readonly FacultyOption[];
  /** Which field the existing server action expects as the value. */
  submit: 'id' | 'email';
  placeholder?: string;
  /** When given, an explicit "no one" choice is offered (course creation). */
  emptyOptionLabel?: string;
  /** Lets a parent enable its submit button only once a choice is made. */
  onSelectedChange?: (selected: FacultyOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FacultyOption | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => matchFaculty(options, query), [options, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(option: FacultyOption | null) {
    setSelected(option);
    setQuery('');
    setOpen(false);
    onSelectedChange?.(option);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => Math.min(Math.max(current + step, 0), matches.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      // Only swallow Enter while the list is open with something to
      // take; otherwise it must still submit the surrounding form.
      if (open && matches[active]) {
        event.preventDefault();
        choose(matches[active]);
      }
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={container} className="relative">
      {/* What the server action actually receives. */}
      <input type="hidden" name={name} value={selected ? selected[submit] : ''} />

      {selected ? (
        <div className="flex items-center gap-2 border border-gray-300 rounded px-2 py-1.5 bg-gray-50">
          <span className="flex-1 truncate">
            <span className="font-medium">{selected.fullName}</span>{' '}
            <span className="text-xs text-gray-600">{selected.email}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              choose(null);
              setOpen(true);
            }}
            className="text-xs text-blue-700 hover:underline shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        /*
         * The browser must not suggest anything here. Its saved
         * addresses are noise on top of the list we are already
         * showing, and the overlay covers our own results — the one
         * thing the user is looking at.
         *
         * `autocomplete="off"` does NOT achieve that, and not by
         * accident: Chrome deliberately ignores it for fields its
         * heuristics classify as contact details, on the grounds that
         * sites were overusing it. This field is classified that way
         * because its placeholder offers to search by email.
         *
         * `new-password` is the lever that works. It is a token from a
         * different autofill scope, so Chrome has no address data to
         * offer against it, and it suppresses the popup where "off" is
         * discarded. It is a known idiom rather than a clean one — if a
         * future version honours "off" for contact fields, this can go
         * back to it.
         *
         * Around it:
         *  - NO `name` attribute. That is what stops browsers recording
         *    and replaying form history for the field, and it is also
         *    why nothing extra is posted: the hidden input above
         *    carries the value the server action reads.
         *  - The data-* opt-outs are a SEPARATE problem — password
         *    managers ignore the autocomplete attribute entirely, and
         *    each vendor reads only its own. They matter doubly now:
         *    without them, "new-password" would invite a manager to
         *    offer to generate one.
         *  - spellCheck/autoCorrect/autoCapitalize: surnames are not
         *    dictionary words, and a phone keyboard capitalising an
         *    email address is a wrong search.
         */
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-form-type="other"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full border border-gray-300 rounded px-2 py-1.5"
        />
      )}

      {open && !selected ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-0.5 w-full max-h-60 overflow-y-auto bg-white border border-gray-300 rounded shadow-lg"
        >
          {emptyOptionLabel ? (
            <li>
              <button
                type="button"
                onClick={() => choose(null)}
                className="w-full text-left px-2 py-1 text-sm text-gray-600 hover:bg-blue-50"
              >
                {emptyOptionLabel}
              </button>
            </li>
          ) : null}

          {matches.length === 0 ? (
            <li className="px-2 py-2 text-sm text-gray-600">
              No active faculty matches “{query}”.
              <span className="block text-xs text-gray-500">
                Only accounts holding the Faculty role appear here.
              </span>
            </li>
          ) : (
            matches.map((option, index) => (
              <li key={option.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  // Pointer-down rather than click: the list closes on
                  // outside pointerdown, which would otherwise fire first
                  // and remove the button before the click landed.
                  onPointerDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`w-full text-left px-2 py-1 text-sm ${index === active ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                >
                  <span className="font-medium">{option.fullName}</span>{' '}
                  <span className="text-xs text-gray-600">{option.email}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {open && !selected && options.length > 0 ? (
        <p className="text-xs text-gray-500 mt-0.5">
          {matches.length} of {options.length} shown — keep typing to narrow, ↑↓ to move, Enter to choose.
        </p>
      ) : null}
    </div>
  );
}
