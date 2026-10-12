/**
 * CR-10: offer a course to another batch — the next year's intake takes
 * the same paper. Each year stays its OWN course instance, with its own
 * marks, lock and snapshot, because each year's attainment is filed on
 * its own; what carries over is the catalogue entry and the set-up.
 *
 * Pure, so the rules and the copy are unit-testable without a database.
 *
 * COPIED: code, title, semester, credits, the Laboratory flag; the COs;
 * the articulation matrix; every assessment with its sections (including
 * the optional-answer count), items (including the knowledge level and
 * CO tag) and SINGLE_SCORE CO tags.
 *
 * NEVER COPIED: marks, enrolments, learner ratings, indirect feedback
 * counts, snapshots, review history, faculty assignments (the HoD staffs
 * each year, FR-4), and course-level parameter overrides (an Academic
 * Council exception minuted for one course instance only).
 *
 * The matrix copies verbatim because the target batch is required to be
 * in the SAME programme, so the PO/PSO ids are the same ones.
 */

export interface OfferTarget {
  id: string;
  name: string;
  programmeId: string;
}

/** Null when the course may be offered to this batch. */
export function offerTargetProblem(args: {
  source: { code: string; batchId: string; programmeId: string };
  target: OfferTarget | null;
  /** The target batch already holds a course with this code. */
  codeTaken: boolean;
}): string | null {
  const { source, target, codeTaken } = args;
  if (!target) return 'Choose a batch.';
  if (target.id === source.batchId) return `${source.code} is already offered to ${target.name} — this is that course.`;
  if (target.programmeId !== source.programmeId) {
    return 'A course can only be offered to a batch of its own programme: its articulation matrix maps onto that programme’s POs and PSOs.';
  }
  if (codeTaken) return `${target.name} already has a course ${source.code}. Open that one instead.`;
  return null;
}

// ── the copy ─────────────────────────────────────────────────────────────

export interface SourceCourseSetup {
  cos: {
    id: string;
    code: string;
    statement: string;
    bloomLevels: string[];
    displayOrder: number;
    matrix: { poId: string; strength: number }[];
  }[];
  assessments: {
    name: string;
    shape: 'SECTIONED' | 'ITEM_LIST' | 'SINGLE_SCORE';
    scoringRule: 'RUBRIC' | 'COHORT_BAND';
    weightGroup: string;
    displayOrder: number;
    sections: { id: string; name: string; displayOrder: number; optionalAnswerCount: number | null }[];
    items: {
      label: string;
      /** Decimal as a string, so no precision is lost on the way through. */
      maxMark: string;
      coId: string | null;
      sectionId: string | null;
      bloomLevel: string | null;
      displayOrder: number;
    }[];
    coTags: { coId: string }[];
  }[];
}

/**
 * The same set-up with every internal reference rewritten as a position:
 * an item names its CO and section by index into the plan's own arrays,
 * since the new rows' ids do not exist until they are created.
 */
export interface CourseCopyPlan {
  cos: { code: string; statement: string; bloomLevels: string[]; displayOrder: number; matrix: { poId: string; strength: number }[] }[];
  assessments: {
    name: string;
    shape: SourceCourseSetup['assessments'][number]['shape'];
    scoringRule: SourceCourseSetup['assessments'][number]['scoringRule'];
    weightGroup: string;
    displayOrder: number;
    sections: { name: string; displayOrder: number; optionalAnswerCount: number | null }[];
    items: {
      label: string;
      maxMark: string;
      coIndex: number | null;
      sectionIndex: number | null;
      bloomLevel: string | null;
      displayOrder: number;
    }[];
    coTagIndexes: number[];
  }[];
}

export function planCourseCopy(source: SourceCourseSetup): CourseCopyPlan {
  const cos = [...source.cos].sort((a, b) => a.displayOrder - b.displayOrder);
  const coIndex = new Map(cos.map((co, index) => [co.id, index]));
  // A reference to something outside this course would be a corrupt
  // source; refuse loudly rather than copy an item with its tag dropped,
  // which would silently make it count towards every CO.
  const toCo = (id: string): number => {
    const index = coIndex.get(id);
    if (index === undefined) throw new Error(`Source set-up references CO ${id}, which is not one of its COs`);
    return index;
  };

  return {
    cos: cos.map((co) => ({
      code: co.code,
      statement: co.statement,
      bloomLevels: [...co.bloomLevels],
      displayOrder: co.displayOrder,
      matrix: co.matrix.map((cell) => ({ poId: cell.poId, strength: cell.strength })),
    })),
    assessments: [...source.assessments]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((assessment) => {
        const sections = [...assessment.sections].sort((a, b) => a.displayOrder - b.displayOrder);
        const sectionIndex = new Map(sections.map((section, index) => [section.id, index]));
        return {
          name: assessment.name,
          shape: assessment.shape,
          scoringRule: assessment.scoringRule,
          weightGroup: assessment.weightGroup,
          displayOrder: assessment.displayOrder,
          sections: sections.map((section) => ({
            name: section.name,
            displayOrder: section.displayOrder,
            optionalAnswerCount: section.optionalAnswerCount,
          })),
          items: [...assessment.items]
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((item) => {
              let section: number | null = null;
              if (item.sectionId !== null) {
                const index = sectionIndex.get(item.sectionId);
                if (index === undefined) {
                  throw new Error(`Item ${item.label} of ${assessment.name} references a section outside its assessment`);
                }
                section = index;
              }
              return {
                label: item.label,
                maxMark: item.maxMark,
                coIndex: item.coId === null ? null : toCo(item.coId),
                sectionIndex: section,
                bloomLevel: item.bloomLevel,
                displayOrder: item.displayOrder,
              };
            }),
          coTagIndexes: assessment.coTags.map((tag) => toCo(tag.coId)).sort((a, b) => a - b),
        };
      }),
  };
}
