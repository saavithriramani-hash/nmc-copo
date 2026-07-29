/**
 * An assessment's maximum mark.
 *
 * There is no `maxMark` column on Assessment: the marks live on the
 * items, so an assessment's maximum is derived. For SINGLE_SCORE that is
 * its one item; otherwise it is the items summed.
 *
 * The subtlety is §3.1's "answer any n of m". Where a section lets a
 * student answer 3 of 5 questions, the sum of all five overstates what
 * anyone can score — the most obtainable is the three highest-valued.
 * Both figures are reported: the paper's printed total, and what a
 * student can actually reach. Conflating them would misstate a paper's
 * weight to whoever is checking it adds up.
 *
 * Nothing here feeds the engine, which excludes blanks per item and has
 * no notion of an assessment total; this is for the people building the
 * paper.
 */

export interface ItemMax {
  sectionId: string | null;
  maxMark: number;
}

export interface SectionRule {
  id: string;
  /** null = every question compulsory. */
  optionalAnswerCount: number | null;
}

export interface AssessmentMaxima {
  /** Every item's maximum, summed — the paper as printed. */
  totalItemMarks: number;
  /** The most a student can score, honouring "answer any n of m". */
  obtainableMax: number;
  /** True when the two differ because a section caps how many count. */
  hasOptionalSections: boolean;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export function assessmentMaxima(items: readonly ItemMax[], sections: readonly SectionRule[]): AssessmentMaxima {
  const totalItemMarks = sum(items.map((item) => item.maxMark));

  const rules = new Map(sections.map((section) => [section.id, section.optionalAnswerCount]));
  const bySection = new Map<string, number[]>();
  const loose: number[] = [];
  for (const item of items) {
    if (item.sectionId === null) loose.push(item.maxMark);
    else {
      const list = bySection.get(item.sectionId) ?? [];
      list.push(item.maxMark);
      bySection.set(item.sectionId, list);
    }
  }

  let obtainableMax = sum(loose);
  let hasOptionalSections = false;
  for (const [sectionId, marks] of bySection) {
    const allowed = rules.get(sectionId) ?? null;
    // A rule that permits at least as many as exist caps nothing.
    if (allowed === null || allowed >= marks.length) {
      obtainableMax += sum(marks);
      continue;
    }
    hasOptionalSections = true;
    // The best a student can do is the highest-valued questions allowed.
    const best = [...marks].sort((a, b) => b - a).slice(0, Math.max(allowed, 0));
    obtainableMax += sum(best);
  }

  return { totalItemMarks, obtainableMax, hasOptionalSections };
}

/** Trims the float noise that summing decimal marks can produce. */
export function formatMark(value: number): string {
  return String(Number(value.toFixed(2)));
}
