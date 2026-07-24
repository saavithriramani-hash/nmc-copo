/**
 * Pure planning logic for assessment templates (FR-8) and course cloning
 * (FR-9). No database access — capture turns course rows into a pattern,
 * apply turns a pattern into create-ready plans for a target course.
 * Unit-tested in tests/setupPlans.test.ts.
 *
 * CO references inside a pattern are 1-based CO-ORDER SLOTS (1 = the
 * course's first CO), because a department template cannot know any
 * course's CO ids. Adoption maps slots onto the target course's COs by
 * display order; a slot beyond the course's CO count becomes an untagged
 * item plus an explicit warning — never a silent guess.
 */

export type Shape = 'SECTIONED' | 'ITEM_LIST' | 'SINGLE_SCORE';
export type Rule = 'RUBRIC' | 'COHORT_BAND';

export interface TemplateItem {
  label: string;
  maxMark: number;
  /** 1-based CO order slot; null = untagged (applies to every CO). */
  coIndex: number | null;
}
export interface TemplateSection {
  name: string;
  items: TemplateItem[];
}
export interface TemplateAssessment {
  name: string;
  shape: Shape;
  scoringRule: Rule;
  weightGroup: string;
  sections?: TemplateSection[];
  items?: TemplateItem[];
  maxMark?: number;
  coIndexTags?: number[];
}
export interface TemplatePattern {
  assessments: TemplateAssessment[];
}

// ── capture: course rows → pattern ──────────────────────────────────────

export interface SourceCo {
  id: string;
  displayOrder: number;
}
export interface SourceItem {
  label: string;
  maxMark: number | string;
  coId: string | null;
  sectionId: string | null;
  displayOrder: number;
}
export interface SourceSection {
  id: string;
  name: string;
  displayOrder: number;
}
export interface SourceAssessment {
  name: string;
  shape: Shape;
  scoringRule: Rule;
  weightGroup: string;
  displayOrder: number;
  sections: SourceSection[];
  items: SourceItem[];
  coTags: { coId: string }[];
}

export function capturePattern(cos: SourceCo[], assessments: SourceAssessment[]): TemplatePattern {
  const ordered = [...cos].sort((a, b) => a.displayOrder - b.displayOrder);
  const indexByCoId = new Map(ordered.map((co, index) => [co.id, index + 1]));
  const toIndex = (coId: string | null): number | null => (coId === null ? null : (indexByCoId.get(coId) ?? null));
  const toItem = (item: SourceItem): TemplateItem => ({
    label: item.label,
    maxMark: Number(item.maxMark),
    coIndex: toIndex(item.coId),
  });

  const pattern: TemplateAssessment[] = [...assessments]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((assessment) => {
      const base = {
        name: assessment.name,
        shape: assessment.shape,
        scoringRule: assessment.scoringRule,
        weightGroup: assessment.weightGroup,
      };
      if (assessment.shape === 'SECTIONED') {
        const sections = [...assessment.sections]
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((section) => ({
            name: section.name,
            items: assessment.items
              .filter((item) => item.sectionId === section.id)
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map(toItem),
          }));
        return { ...base, sections };
      }
      if (assessment.shape === 'ITEM_LIST') {
        return { ...base, items: [...assessment.items].sort((a, b) => a.displayOrder - b.displayOrder).map(toItem) };
      }
      const single = assessment.items[0];
      const coIndexTags = assessment.coTags
        .map((tag) => toIndex(tag.coId))
        .filter((index): index is number => index !== null)
        .sort((a, b) => a - b);
      return {
        ...base,
        maxMark: single ? Number(single.maxMark) : 0,
        ...(coIndexTags.length > 0 ? { coIndexTags } : {}),
      };
    });

  return { assessments: pattern };
}

// ── apply: pattern + target COs → create-ready plans ────────────────────

export interface PlanItem {
  label: string;
  maxMark: number;
  coId: string | null;
  displayOrder: number;
}
export interface PlanSection {
  name: string;
  displayOrder: number;
  items: PlanItem[];
}
export interface AssessmentPlan {
  name: string;
  shape: Shape;
  scoringRule: Rule;
  weightGroup: string;
  displayOrder: number;
  sections: PlanSection[];
  items: PlanItem[];
  /** SINGLE_SCORE only: the one item every mark will reference. */
  singleMaxMark: number | null;
  coTagIds: string[];
}

export function applyPattern(
  pattern: TemplatePattern,
  targetCos: { id: string }[],
): { plans: AssessmentPlan[]; warnings: string[] } {
  const warnings = new Set<string>();
  const resolveCo = (coIndex: number | null): string | null => {
    if (coIndex === null) return null;
    const co = targetCos[coIndex - 1];
    if (!co) {
      warnings.add(`The pattern tags CO${coIndex}, but this course defines only ${targetCos.length} CO${targetCos.length === 1 ? '' : 's'} — those items are left untagged (they will count towards every CO).`);
      return null;
    }
    return co.id;
  };
  const toPlanItems = (items: TemplateItem[]): PlanItem[] =>
    items.map((item, index) => ({
      label: item.label,
      maxMark: item.maxMark,
      coId: resolveCo(item.coIndex),
      displayOrder: index + 1,
    }));

  const plans: AssessmentPlan[] = pattern.assessments.map((assessment, index) => ({
    name: assessment.name,
    shape: assessment.shape,
    scoringRule: assessment.scoringRule,
    weightGroup: assessment.weightGroup,
    displayOrder: index + 1,
    sections:
      assessment.shape === 'SECTIONED'
        ? (assessment.sections ?? []).map((section, sectionIndex) => ({
            name: section.name,
            displayOrder: sectionIndex + 1,
            items: toPlanItems(section.items),
          }))
        : [],
    items: assessment.shape === 'ITEM_LIST' ? toPlanItems(assessment.items ?? []) : [],
    singleMaxMark: assessment.shape === 'SINGLE_SCORE' ? (assessment.maxMark ?? 0) : null,
    coTagIds:
      assessment.shape === 'SINGLE_SCORE'
        ? (assessment.coIndexTags ?? []).map(resolveCo).filter((id): id is string => id !== null)
        : [],
  }));

  return { plans, warnings: [...warnings] };
}

// ── pattern validation (reading back JSON from the database) ────────────

export function parsePattern(value: unknown): TemplatePattern {
  const fail = (message: string): never => {
    throw new Error(`Malformed template pattern: ${message}`);
  };
  if (typeof value !== 'object' || value === null || !Array.isArray((value as TemplatePattern).assessments)) {
    fail('expected { assessments: [...] }');
  }
  const pattern = value as TemplatePattern;
  for (const assessment of pattern.assessments) {
    if (!assessment.name || typeof assessment.name !== 'string') fail('assessment name missing');
    if (!['SECTIONED', 'ITEM_LIST', 'SINGLE_SCORE'].includes(assessment.shape)) fail(`bad shape ${String(assessment.shape)}`);
    if (!['RUBRIC', 'COHORT_BAND'].includes(assessment.scoringRule)) fail(`bad scoring rule ${String(assessment.scoringRule)}`);
    if (assessment.scoringRule === 'COHORT_BAND' && assessment.shape !== 'SINGLE_SCORE') {
      fail('COHORT_BAND is defined for SINGLE_SCORE only');
    }
    if (typeof assessment.weightGroup !== 'string' || assessment.weightGroup === '') fail('weight group missing');
    const items = [
      ...(assessment.items ?? []),
      ...(assessment.sections ?? []).flatMap((section) => section.items),
    ];
    for (const item of items) {
      if (typeof item.maxMark !== 'number' || !(item.maxMark > 0)) fail(`item '${item.label}' needs a positive maximum`);
      if (item.coIndex !== null && (!Number.isInteger(item.coIndex) || item.coIndex < 1) && item.coIndex !== undefined) {
        fail(`item '${item.label}' has a bad CO slot`);
      }
    }
    if (assessment.shape === 'SINGLE_SCORE' && (typeof assessment.maxMark !== 'number' || !(assessment.maxMark > 0))) {
      fail(`single-score assessment '${assessment.name}' needs a positive maximum`);
    }
  }
  return pattern;
}
