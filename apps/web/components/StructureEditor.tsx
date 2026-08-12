'use client';

import { useState, useTransition } from 'react';
import {
  saveAssessmentStructureAction,
  type StructureItemInput,
  type StructurePayload,
  type StructureSectionInput,
} from '@/actions/assessment';
import { assessmentMaxima, formatMark } from '@/lib/assessmentMaxima';
import { formatThresholdPercent } from '@/lib/courseThreshold';

interface CoOption {
  id: string;
  code: string;
}

interface Props {
  assessmentId: string;
  shape: 'SECTIONED' | 'ITEM_LIST' | 'SINGLE_SCORE';
  canEdit: boolean;
  cos: CoOption[];
  weightGroups: string[];
  /** Resolved for THIS course (§4.1) — the HoD may override it, so it is
   *  never assumed to be the institution default. */
  thresholdFraction: number;
  initial: {
    name: string;
    weightGroup: string;
    scoringRule: 'RUBRIC' | 'COHORT_BAND';
    sections: StructureSectionInput[];
    items: StructureItemInput[];
    singleMaxMark: number | null;
    coTagIds: string[];
  };
}

/**
 * The assessment structure editor. One component, three shapes, no shape
 * assumed: SECTIONED gets user-named, unlimited sections; ITEM_LIST a
 * flat item table; SINGLE_SCORE a maximum plus CO tags. Enter in the last
 * row adds another; explicit Save writes the whole structure atomically.
 */
export function StructureEditor({ assessmentId, shape, canEdit, cos, weightGroups, thresholdFraction, initial }: Props) {
  const [name, setName] = useState(initial.name);
  const [weightGroup, setWeightGroup] = useState(initial.weightGroup);
  const [scoringRule, setScoringRule] = useState(initial.scoringRule);
  const [sections, setSections] = useState<StructureSectionInput[]>(initial.sections);
  const [items, setItems] = useState<StructureItemInput[]>(initial.items);
  const [singleMaxMark, setSingleMaxMark] = useState<number>(initial.singleMaxMark ?? 0);
  const [coTagIds, setCoTagIds] = useState<string[]>(initial.coTagIds);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Which owner to name in the read-only notice below. Read from the
  // assessment as it stands, not from the editable state, because the
  // notice is shown precisely when nothing here is editable.
  const isExternal = initial.weightGroup === 'external';

  const touch = () => {
    setDirty(true);
    setMessage(null);
  };

  const newItem = (count: number): StructureItemInput => ({ id: null, label: `Q${count + 1}`, maxMark: 2, coId: null });

  // ── section helpers ──
  const updateSection = (index: number, patch: Partial<StructureSectionInput>) => {
    setSections((current) => current.map((section, i) => (i === index ? { ...section, ...patch } : section)));
    touch();
  };
  const moveSection = (index: number, delta: -1 | 1) => {
    setSections((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [section] = next.splice(index, 1);
      next.splice(target, 0, section!);
      return next;
    });
    touch();
  };
  const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0);

  /**
   * The paper's maximum, live while it is being built (§3.1). Shown
   * because a paper that does not add up to its intended total is the
   * easiest mistake to make here and the hardest to notice afterwards.
   * "Answer any n of m" is honoured, so the figure is what a student can
   * actually score.
   */
  const maxima =
    shape === 'SECTIONED'
      ? assessmentMaxima(
          sections.flatMap((section) => section.items.map((item) => ({ sectionId: section.name, maxMark: item.maxMark }))),
          sections.map((section) => ({ id: section.name, optionalAnswerCount: section.optionalAnswerCount ?? null })),
        )
      : shape === 'ITEM_LIST'
        ? assessmentMaxima(items.map((item) => ({ sectionId: null, maxMark: item.maxMark })), [])
        : assessmentMaxima([{ sectionId: null, maxMark: singleMaxMark }], []);

  // ── item helpers (work for both sectioned and flat lists) ──
  const itemRow = (
    item: StructureItemInput,
    onChange: (patch: Partial<StructureItemInput>) => void,
    onRemove: () => void,
    onEnterLast: (() => void) | null,
    key: React.Key,
  ) => (
    <tr key={key}>
      <td className="border border-gray-300 px-1 py-0.5">
        <input value={item.label} onChange={(e) => onChange({ label: e.target.value })} className="w-full border-0 px-1 py-1" />
      </td>
      <td className="border border-gray-300 px-1 py-0.5">
        <input
          type="number"
          step="0.5"
          min={0.5}
          value={Number.isFinite(item.maxMark) ? item.maxMark : ''}
          onChange={(e) => onChange({ maxMark: Number(e.target.value) })}
          className="w-20 border-0 px-1 py-1 text-right"
        />
      </td>
      <td className="border border-gray-300 px-1 py-0.5">
        <select
          value={item.coId ?? ''}
          onChange={(e) => onChange({ coId: e.target.value === '' ? null : e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnterLast) {
              e.preventDefault();
              onEnterLast();
            }
          }}
          className="w-full border-0 py-1"
        >
          <option value="">— every CO —</option>
          {cos.map((co) => (
            <option key={co.id} value={co.id}>
              {co.code}
            </option>
          ))}
        </select>
      </td>
      <td className="border border-gray-300 px-1 py-0.5 text-center">
        <button type="button" onClick={onRemove} className="text-red-700 hover:underline">
          remove
        </button>
      </td>
    </tr>
  );

  const itemsTable = (
    list: StructureItemInput[],
    setList: (updater: (current: StructureItemInput[]) => StructureItemInput[]) => void,
  ) => (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-gray-50 text-left text-xs">
          <th className="border border-gray-300 px-2 py-1">Question / item</th>
          {/* SINGULAR, and deliberately: this is what ONE question is
              worth. Totals — the paper's maximum, the single-score
              figure, the assessments list — read "Maximum marks". */}
          <th className="border border-gray-300 px-2 py-1 w-24">Max mark</th>
          <th className="border border-gray-300 px-2 py-1 w-40">CO tag</th>
          <th className="border border-gray-300 px-2 py-1 w-20"></th>
        </tr>
      </thead>
      <tbody>
        {list.map((item, index) =>
          itemRow(
            item,
            (patch) => {
              setList((current) => current.map((it, i) => (i === index ? { ...it, ...patch } : it)));
              touch();
            },
            () => {
              setList((current) => current.filter((_, i) => i !== index));
              touch();
            },
            index === list.length - 1
              ? () => {
                  setList((current) => [...current, newItem(totalItems + items.length)]);
                  touch();
                }
              : null,
            item.id ?? `new-${index}`,
          ),
        )}
      </tbody>
    </table>
  );

  const save = () =>
    startTransition(async () => {
      const payload: StructurePayload = {
        name,
        weightGroup,
        scoringRule,
        ...(shape === 'SECTIONED' ? { sections } : {}),
        ...(shape === 'ITEM_LIST' ? { items } : {}),
        ...(shape === 'SINGLE_SCORE' ? { single: { maxMark: singleMaxMark, coTagIds } } : {}),
      };
      const result = await saveAssessmentStructureAction(assessmentId, payload);
      setMessage(result.error ?? 'Saved.');
      if (!result.error) setDirty(false);
    });

  if (!canEdit) {
    // CR-3 split this: the end-semester paper of a theory course is the
    // Controller of Examinations', everything else the course chain's.
    // Naming the wrong owner sends people to the wrong colleague.
    return (
      <p className="text-xs text-gray-500">
        {isExternal
          ? 'Read-only: the end-semester examination of a theory course is set by the Controller of Examinations. Marking the course as Laboratory on its Details tab hands its practical examination to the department.'
          : 'Read-only: structure is edited by the course faculty (while DRAFT) or the HoD.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── meta ── */}
      <div className="flex flex-wrap items-end gap-3 bg-white border border-gray-300 rounded p-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Name</span>
          <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="border border-gray-300 rounded px-2 py-1.5 w-56" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Weight group</span>
          <select value={weightGroup} onChange={(e) => { setWeightGroup(e.target.value); touch(); }} className="border border-gray-300 rounded px-2 py-1.5">
            {weightGroups.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </select>
        </label>
        {shape === 'SINGLE_SCORE' ? (
          <>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Scoring rule</span>
              <select value={scoringRule} onChange={(e) => { setScoringRule(e.target.value as 'RUBRIC' | 'COHORT_BAND'); touch(); }} className="border border-gray-300 rounded px-2 py-1.5">
                <option value="RUBRIC">Rubric ({formatThresholdPercent(thresholdFraction)}% threshold)</option>
                <option value="COHORT_BAND">Cohort band (end-semester)</option>
              </select>
            </label>
            <label className="block">
              {/* The single-score paper's total — plural, like the
                  assessments list. The per-question column below stays
                  singular; see the note on that header. */}
              <span className="block text-xs font-medium text-gray-700 mb-1">Maximum marks</span>
              <input type="number" step="0.5" min={0.5} value={singleMaxMark} onChange={(e) => { setSingleMaxMark(Number(e.target.value)); touch(); }} className="border border-gray-300 rounded px-2 py-1.5 w-28 text-right" />
            </label>
          </>
        ) : (
          <p className="text-xs text-gray-500 self-center">
            Scoring: rubric ({formatThresholdPercent(thresholdFraction)}% threshold → attainment bands).
          </p>
        )}
      </div>

      {/* ── shape-specific structure ── */}
      {shape === 'SECTIONED' ? (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <div key={section.id ?? `new-${index}`} className="bg-white border border-gray-300 rounded">
              <div className="flex items-center gap-2 border-b border-gray-300 bg-gray-50 px-2 py-1.5">
                <input
                  value={section.name}
                  onChange={(e) => updateSection(index, { name: e.target.value })}
                  className="border border-gray-300 rounded px-2 py-1 font-medium w-56"
                  aria-label="Section name"
                />
                <button type="button" onClick={() => moveSection(index, -1)} disabled={index === 0} className="px-1 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => moveSection(index, 1)} disabled={index === sections.length - 1} className="px-1 disabled:opacity-30">↓</button>
                <label className="flex items-center gap-1 text-xs text-gray-700">
                  answer any
                  <input
                    type="number"
                    min={1}
                    max={section.items.length}
                    value={section.optionalAnswerCount ?? ''}
                    onChange={(e) => updateSection(index, { optionalAnswerCount: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="all"
                    className="border border-gray-300 rounded px-1 py-0.5 w-14 text-center"
                    aria-label="answer any n questions"
                  />
                  of {section.items.length}
                </label>
                <button
                  type="button"
                  onClick={() => { setSections((current) => current.filter((_, i) => i !== index)); touch(); }}
                  className="ml-auto text-red-700 hover:underline text-xs"
                >
                  remove section
                </button>
              </div>
              <div className="p-2 space-y-2">
                {itemsTable(section.items, (updater) =>
                  setSections((current) => current.map((s, i) => (i === index ? { ...s, items: updater(s.items) } : s))),
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSections((current) => current.map((s, i) => (i === index ? { ...s, items: [...s.items, newItem(totalItems)] } : s)));
                    touch();
                  }}
                  className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 text-xs"
                >
                  + item
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setSections((current) => [...current, { id: null, name: `Section ${String.fromCharCode(65 + current.length)}`, optionalAnswerCount: null, items: [] }]); touch(); }}
            className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100"
          >
            + section
          </button>
        </div>
      ) : null}

      {shape === 'ITEM_LIST' ? (
        <div className="bg-white border border-gray-300 rounded p-2 space-y-2">
          {itemsTable(items, (updater) => setItems((current) => updater(current)))}
          <button type="button" onClick={() => { setItems((current) => [...current, newItem(current.length)]); touch(); }} className="border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 text-xs">
            + item
          </button>
        </div>
      ) : null}

      {shape === 'SINGLE_SCORE' ? (
        <div className="bg-white border border-gray-300 rounded p-3 space-y-2">
          <p className="text-xs font-medium text-gray-700">Counts towards:</p>
          <div className="flex flex-wrap gap-3">
            {cos.map((co) => (
              <label key={co.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={coTagIds.includes(co.id)}
                  onChange={(e) => {
                    setCoTagIds((current) => (e.target.checked ? [...current, co.id] : current.filter((id) => id !== co.id)));
                    touch();
                  }}
                />
                {co.code}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Nothing ticked = the score counts towards <b>every</b> CO — how the end-semester paper works.
          </p>
        </div>
      ) : null}

      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm">
        Maximum marks: <strong>{formatMark(maxima.obtainableMax)}</strong>
        {maxima.hasOptionalSections ? (
          <span className="text-xs text-gray-600">
            {' '}
            — {formatMark(maxima.totalItemMarks)} marks are printed, but a section limits how many questions count, so
            this is the most a student can score.
          </span>
        ) : null}
        {totalItems === 0 && shape !== 'SINGLE_SCORE' ? (
          <span className="text-xs text-amber-700"> — no questions added yet.</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={!dirty || pending} className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save structure'}
        </button>
        {dirty ? <span className="text-xs text-amber-700">Unsaved changes</span> : null}
        {message ? <span className="text-xs text-gray-700">{message}</span> : null}
      </div>
    </div>
  );
}
