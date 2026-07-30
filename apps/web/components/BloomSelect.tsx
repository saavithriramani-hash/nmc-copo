'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BLOOM_LEVELS, bloomShortLabel, type BloomLevel } from '@/lib/bloom';

/**
 * Multi-select dropdown for a CO's Bloom levels.
 *
 * The menu holds real `<input type="checkbox">` elements rather than
 * hand-rolled `role="option"` items. A listbox with multi-select ARIA
 * needs roving focus and `aria-activedescendant` to behave, and gets
 * subtly wrong in ways nobody notices until a screen reader is used;
 * checkboxes announce their checked state and take Tab and Space for
 * free. The menu therefore stays open as you tick — which is what makes
 * it multi-select rather than a picker that closes after one choice.
 *
 * Closes on Escape (returning focus to the trigger, so the keyboard
 * position is not lost) and on a click outside. It does NOT close on
 * blur: moving between the checkboxes inside it is a blur.
 */
export function BloomSelect({
  code,
  selected,
  onToggle,
}: {
  code: string;
  selected: readonly string[];
  onToggle: (level: BloomLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Ordered by the taxonomy, not by the order they were ticked, so the
  // same set always reads the same way.
  const chosen = BLOOM_LEVELS.filter((level) => selected.includes(level));
  const summary = chosen.length === 0 ? 'Select levels' : chosen.join(', ');

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        title={chosen.length > 0 ? chosen.map(bloomShortLabel).join(', ') : 'No Bloom level chosen'}
        className={`w-full text-xs text-left border rounded px-1.5 py-1 flex items-center gap-1 bg-white hover:bg-gray-50 ${
          chosen.length === 0 ? 'border-red-400 text-red-700' : 'border-gray-300 text-gray-800'
        }`}
      >
        <span className="flex-1 truncate">{summary}</span>
        {chosen.length > 1 ? (
          <span className="shrink-0 text-[10px] bg-blue-100 text-blue-800 rounded px-1">{chosen.length}</span>
        ) : null}
        <span aria-hidden="true" className="shrink-0 text-gray-500">
          ▾
        </span>
      </button>

      {open ? (
        <fieldset
          id={menuId}
          className="absolute z-20 mt-0.5 w-44 bg-white border border-gray-300 rounded shadow-lg py-0.5"
        >
          <legend className="sr-only">Bloom levels for {code}</legend>
          {BLOOM_LEVELS.map((level) => (
            <label
              key={level}
              className="flex items-center gap-1.5 text-xs px-2 py-1 hover:bg-blue-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(level)}
                onChange={() => onToggle(level)}
                className="shrink-0"
              />
              {bloomShortLabel(level)}
            </label>
          ))}
        </fieldset>
      ) : null}

      {chosen.length === 0 ? <p className="text-xs text-red-700 mt-0.5">Choose at least one.</p> : null}
    </div>
  );
}
