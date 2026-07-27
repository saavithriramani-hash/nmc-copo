import { Prisma, type PrismaClient } from '@prisma/client';
import {
  step2ResolveParameters,
  type Assessment as EngineAssessment,
  type CourseInput,
  type IndirectCounts,
  type Item as EngineItem,
  type MappingStrength,
  type MarkRecord,
  type PoMatrix,
  type Step2Result,
} from '@copo/engine';
import { AdapterError } from './errors';
import { institutionParameters, parameterOverrides } from './parameters';

/**
 * The adapter: reads a course from the database and produces the engine's
 * CourseInput. The engine stays unaware that a database exists — this
 * module depends on the engine, never the other way round.
 *
 * Scale discipline (NFR-1): the ONLY marks ever materialised are the one
 * course's own rows, fetched by assessment id through the
 * (assessmentId, enrolmentId) index — bounded by course size (a few
 * thousand values), never by the 25-million-row table. Anything that is a
 * summary (counts, completeness, anomalies) is aggregated in SQL instead
 * — see queries.ts.
 */

/** The exact shape loadCourseInput fetches; buildCourseInput is pure over it. */
export const courseInputArgs = Prisma.validator<Prisma.CourseDefaultArgs>()({
  include: {
    batch: {
      include: {
        programme: {
          include: {
            department: { include: { institution: true } },
            outcomes: { orderBy: { displayOrder: 'asc' } },
          },
        },
      },
    },
    cos: {
      orderBy: { displayOrder: 'asc' },
      include: { matrixEntries: true, indirect: true },
    },
    assessments: {
      orderBy: { displayOrder: 'asc' },
      include: {
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: { items: { orderBy: { displayOrder: 'asc' } } },
        },
        items: { orderBy: { displayOrder: 'asc' } },
        coTags: true,
      },
    },
  },
});

export type CourseForInput = Prisma.CourseGetPayload<typeof courseInputArgs>;

/** One mark row as fetched for the adapter — FK ids and the value, nothing else. */
export interface MarkRow {
  enrolmentId: string;
  itemId: string;
  assessmentId: string;
  value: Prisma.Decimal | null;
}

export interface CourseLoadResult {
  courseId: string;
  /** Ready for computeCourse. Marks are keyed by enrolment id — the register number never appears. */
  input: CourseInput;
  /** Engine Step 2 output: resolved parameters plus per-field provenance for the report (§4, FR-3). */
  parameterResolution: Step2Result;
  /** Opaque-id → display-code maps so reports can label engine output. */
  refs: {
    coCodeById: Record<string, string>;
    poCodeById: Record<string, string>;
  };
}

type SectionRows = CourseForInput['assessments'][number]['sections'];
type ItemRow = CourseForInput['assessments'][number]['items'][number];

function toEngineItem(item: ItemRow): EngineItem {
  return { id: item.id, maxMark: item.maxMark.toNumber(), coTag: item.coId ?? null };
}

/**
 * Pure transform: database rows in, engine CourseInput out. Split from the
 * fetching so it is unit-testable without a database.
 */
export function buildCourseInput(course: CourseForInput, markRows: readonly MarkRow[]): CourseLoadResult {
  const programme = course.batch.programme;
  const institution = programme.department.institution;

  // Parameters: institution → programme → course, resolved by the engine
  // itself so the provenance shown on reports is the engine's own.
  const parameterResolution = step2ResolveParameters(
    institutionParameters(institution),
    parameterOverrides(programme),
    parameterOverrides(course),
  );

  // COs, in display order. Engine ids are the database ids.
  const cos = course.cos.map((co) => ({ id: co.id, statement: co.statement, bloomLevels: co.bloomLevels }));

  // Articulation matrix: every PO/PSO of the programme appears as a column
  // in every CO row; a missing ArticulationMatrix cell is null (unmapped),
  // so a PO nothing maps to still reaches the engine and draws its
  // PO_UNMAPPED warning instead of silently vanishing from the report.
  const poMatrix: PoMatrix = {};
  for (const co of course.cos) {
    const row: Record<string, MappingStrength | null> = {};
    for (const po of programme.outcomes) row[po.id] = null;
    for (const cell of co.matrixEntries) row[cell.poId] = cell.strength as MappingStrength;
    poMatrix[co.id] = row;
  }

  // Marks grouped per assessment, keyed enrolmentId → itemId → value.
  // NULL stays null: "did not attempt" survives the trip verbatim.
  const marksByAssessment = new Map<string, MarkRecord>();
  for (const mark of markRows) {
    let record = marksByAssessment.get(mark.assessmentId);
    if (!record) {
      record = {};
      marksByAssessment.set(mark.assessmentId, record);
    }
    const row = (record[mark.enrolmentId] ??= {});
    row[mark.itemId] = mark.value === null ? null : mark.value.toNumber();
  }

  const coOrder = new Map(course.cos.map((co, index) => [co.id, index]));

  const assessments: EngineAssessment[] = course.assessments.map((a) => {
    const base = {
      id: a.id,
      name: a.name,
      scoringRule: a.scoringRule,
      weightGroup: a.weightGroup,
    } as const;
    const marks = marksByAssessment.get(a.id) ?? {};

    if (a.shape === 'SECTIONED') {
      assertSectioned(a.id, a.sections, a.items);
      return {
        ...base,
        shape: 'SECTIONED',
        sections: a.sections.map((s) => ({ id: s.id, name: s.name, items: s.items.map(toEngineItem) })),
        marks,
      };
    }

    if (a.shape === 'ITEM_LIST') {
      if (a.sections.length > 0) {
        throw new AdapterError(`ITEM_LIST assessment '${a.id}' has ${a.sections.length} section(s); sections belong to SECTIONED only`);
      }
      return { ...base, shape: 'ITEM_LIST', items: a.items.map(toEngineItem), marks };
    }

    // SINGLE_SCORE: the database stores one real Item row (marks must
    // reference an Item by foreign key); the engine models the score as a
    // pseudo-item keyed by the ASSESSMENT id. Re-key here.
    if (a.items.length !== 1) {
      throw new AdapterError(`SINGLE_SCORE assessment '${a.id}' must have exactly one item, found ${a.items.length}`);
    }
    const scoreItem = a.items[0]!;
    const rekeyed: MarkRecord = {};
    for (const [enrolmentId, row] of Object.entries(marks)) {
      const value = row[scoreItem.id];
      if (value !== undefined) rekeyed[enrolmentId] = { [a.id]: value };
    }
    const coTags = a.coTags
      .map((tag) => tag.coId)
      .sort((x, y) => (coOrder.get(x) ?? 0) - (coOrder.get(y) ?? 0));
    return {
      ...base,
      shape: 'SINGLE_SCORE',
      maxMark: scoreItem.maxMark.toNumber(),
      ...(coTags.length > 0 ? { coTags } : {}),
      marks: rekeyed,
    };
  });

  // Indirect feedback: only COs that actually have a row; a missing row
  // means "no feedback", which the engine flags rather than zero-fills.
  const indirect: Record<string, IndirectCounts> = {};
  for (const co of course.cos) {
    if (co.indirect) indirect[co.id] = { n1: co.indirect.n1, n2: co.indirect.n2, n3: co.indirect.n3 };
  }

  const input: CourseInput = {
    cos,
    poMatrix,
    parameters: parameterResolution.parameters,
    assessments,
    indirect,
  };

  return {
    courseId: course.id,
    input,
    parameterResolution,
    refs: {
      coCodeById: Object.fromEntries(course.cos.map((co) => [co.id, co.code])),
      poCodeById: Object.fromEntries(programme.outcomes.map((po) => [po.id, po.code])),
    },
  };
}

function assertSectioned(assessmentId: string, sections: SectionRows, items: ItemRow[]): void {
  if (sections.length === 0) {
    throw new AdapterError(`SECTIONED assessment '${assessmentId}' has no sections`);
  }
  const stray = items.filter((item) => item.sectionId === null);
  if (stray.length > 0) {
    throw new AdapterError(
      `SECTIONED assessment '${assessmentId}' has ${stray.length} item(s) outside any section: ${stray.map((i) => i.id).join(', ')}`,
    );
  }
}

/**
 * Reads one course and produces the engine input. Two queries: the course
 * aggregate (structure only — no marks nested), and the course's own mark
 * rows via the (assessmentId, enrolmentId) index. Never more than one
 * course's marks in memory, and only ever for the attainment computation
 * itself — summaries go through SQL aggregation (queries.ts).
 */
export async function loadCourseInput(prisma: PrismaClient, courseId: string): Promise<CourseLoadResult> {
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    ...courseInputArgs,
  });

  const assessmentIds = course.assessments.map((a) => a.id);
  const markRows: MarkRow[] =
    assessmentIds.length === 0
      ? []
      : await prisma.markValue.findMany({
          where: { assessmentId: { in: assessmentIds } },
          select: { enrolmentId: true, itemId: true, assessmentId: true, value: true },
          orderBy: [{ assessmentId: 'asc' }, { enrolmentId: 'asc' }],
        });

  return buildCourseInput(course, markRows);
}
