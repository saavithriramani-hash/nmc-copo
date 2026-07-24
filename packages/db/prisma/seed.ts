/**
 * LOCAL DEVELOPMENT SEED — never an oracle.
 *
 * Creates one department, one programme with POs and PSOs, one batch with
 * 40 students, and one course with two sectioned tests, a quiz, a seminar,
 * an assignment and an end-semester assessment, with pseudo-random marks.
 *
 * The marks are deterministic (seeded PRNG) so every developer gets the
 * same database, but they validate NOTHING: engine correctness rests
 * solely on the hand-computed fixtures in packages/engine (NFR-7).
 *
 * Ids are deterministic strings ("co1", "cia1-q3") to make the dev
 * database greppable. Run against an empty database:
 *   npx prisma migrate reset   (drops, migrates, reseeds)
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { DEFAULT_PARAMETERS } from '@copo/engine';

const prisma = new PrismaClient();

// ── deterministic PRNG (mulberry32) — reproducible dev data ──────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260724);

/**
 * A pseudo-random mark for one item: ~7% blank (null = did not attempt),
 * otherwise a value in [0, maxMark] quantised to 0.5, skewed towards the
 * upper half so the cohort looks like a real class.
 */
function randomMark(maxMark: number): number | null {
  if (rng() < 0.07) return null;
  const skewed = Math.pow(rng(), 0.6); // bias towards 1
  const steps = Math.round(maxMark * 2);
  const value = Math.round(skewed * steps) / 2;
  return Math.min(maxMark, Math.max(0, value));
}

const FIRST = ['Anitha', 'Bala', 'Chitra', 'Deepak', 'Ezhil', 'Gowri', 'Hari', 'Ilango', 'Janani', 'Kavya',
  'Lakshmi', 'Mani', 'Nila', 'Oviya', 'Prakash', 'Rani', 'Senthil', 'Tamil', 'Uma', 'Vimal'];
const LAST = ['Kumar', 'Raj', 'Selvi', 'Murugan', 'Devi', 'Krishnan', 'Priya', 'Anand'];

function studentName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${LAST[Math.floor(rng() * LAST.length)]}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

async function main(): Promise<void> {
  if ((await prisma.institution.count()) > 0) {
    console.log('Database is not empty — refusing to seed. Use `npx prisma migrate reset` to drop, migrate and reseed.');
    return;
  }

  const D = (v: number) => new Prisma.Decimal(v);
  const P = DEFAULT_PARAMETERS; // §4 defaults, straight from the engine

  // ── institution / department / programme ──────────────────────────────
  await prisma.institution.create({
    data: {
      id: 'inst-nmc',
      name: 'Nehru Memorial College (Autonomous), Puthanampatti',
      thresholdFraction: D(P.thresholdFraction),
      bands: P.bands as unknown as Prisma.InputJsonValue,
      cohortBands: P.cohortBands as unknown as Prisma.InputJsonValue,
      weightGroups: P.weightGroups as unknown as Prisma.InputJsonValue,
      directWeight: D(P.directWeight),
      indirectWeight: D(P.indirectWeight),
      targetAttainment: D(P.targetAttainment),
      feedbackResponseFloor: P.feedbackResponseFloor,
    },
  });

  await prisma.department.create({
    data: { id: 'dept-math', institutionId: 'inst-nmc', name: 'Mathematics' },
  });

  await prisma.programme.create({
    data: { id: 'prog-bsc-math', departmentId: 'dept-math', name: 'B.Sc. Mathematics' },
  });

  const poDefs = [
    { id: 'po1', code: 'PO1', kind: 'PO', statement: 'Disciplinary knowledge' },
    { id: 'po2', code: 'PO2', kind: 'PO', statement: 'Critical thinking and problem solving' },
    { id: 'po3', code: 'PO3', kind: 'PO', statement: 'Analytical reasoning' },
    { id: 'po4', code: 'PO4', kind: 'PO', statement: 'Communication skills' },
    { id: 'po5', code: 'PO5', kind: 'PO', statement: 'Lifelong learning' },
    { id: 'pso1', code: 'PSO1', kind: 'PSO', statement: 'Apply mathematical structures to concrete problems' },
    { id: 'pso2', code: 'PSO2', kind: 'PSO', statement: 'Construct and communicate rigorous proofs' },
  ] as const;
  await prisma.programmeOutcome.createMany({
    data: poDefs.map((po, i) => ({ ...po, programmeId: 'prog-bsc-math', displayOrder: i + 1 })),
  });

  // ── batch, students, roster ────────────────────────────────────────────
  await prisma.batch.create({
    data: { id: 'batch-2024', programmeId: 'prog-bsc-math', name: '2024–2027', startYear: 2024, endYear: 2027 },
  });

  const studentIds = Array.from({ length: 40 }, (_, i) => `stu-${pad(i + 1)}`);
  await prisma.student.createMany({
    data: studentIds.map((id, i) => ({ id, fullName: studentName(i) })),
  });
  await prisma.batchRoster.createMany({
    data: studentIds.map((studentId, i) => ({
      id: `ros-${pad(i + 1)}`,
      batchId: 'batch-2024',
      studentId,
      registerNumber: `24MAT${String(i + 1).padStart(3, '0')}`,
    })),
  });

  // ── users and roles ────────────────────────────────────────────────────
  // passwordHash is a dev placeholder — real hashing arrives with the
  // application's auth layer (Phase 1, local accounts).
  await prisma.user.createMany({
    data: [
      { id: 'user-admin', email: 'admin@nmc.dev', fullName: 'System Administrator', passwordHash: 'DEV-PLACEHOLDER' },
      { id: 'user-hod-math', email: 'hod.math@nmc.dev', fullName: 'HoD Mathematics', passwordHash: 'DEV-PLACEHOLDER' },
      { id: 'user-fac-1', email: 'faculty1@nmc.dev', fullName: 'Course Faculty', passwordHash: 'DEV-PLACEHOLDER' },
    ],
  });
  const effectiveFrom = new Date('2024-06-01T00:00:00Z');
  await prisma.role.createMany({
    data: [
      { id: 'role-admin', userId: 'user-admin', kind: 'ADMIN', effectiveFrom },
      { id: 'role-hod', userId: 'user-hod-math', kind: 'HOD', departmentId: 'dept-math', effectiveFrom },
      { id: 'role-fac', userId: 'user-fac-1', kind: 'FACULTY', effectiveFrom },
    ],
  });

  // ── course, COs, articulation matrix ──────────────────────────────────
  await prisma.course.create({
    data: {
      id: 'course-mat301',
      batchId: 'batch-2024',
      code: 'MAT301',
      title: 'Real Analysis',
      semester: 3,
      credits: D(4),
    },
  });
  await prisma.courseInstructor.create({ data: { courseId: 'course-mat301', userId: 'user-fac-1' } });

  const coDefs = [
    { id: 'co1', code: 'CO1', statement: 'Recall the completeness property of the real line', bloomLevel: 'Remember' },
    { id: 'co2', code: 'CO2', statement: 'Explain convergence of sequences and series', bloomLevel: 'Understand' },
    { id: 'co3', code: 'CO3', statement: 'Apply convergence tests to concrete series', bloomLevel: 'Apply' },
    { id: 'co4', code: 'CO4', statement: 'Analyse continuity and uniform continuity', bloomLevel: 'Analyse' },
    { id: 'co5', code: 'CO5', statement: 'Construct rigorous epsilon-delta proofs', bloomLevel: 'Create' },
  ];
  await prisma.courseOutcome.createMany({
    data: coDefs.map((co, i) => ({ ...co, courseId: 'course-mat301', displayOrder: i + 1 })),
  });

  // Matrix: each CO maps to a plausible subset of POs/PSOs. Deterministic
  // via the PRNG; unmapped cells are simply absent.
  const matrixData: { coId: string; poId: string; strength: number }[] = [];
  for (const co of coDefs) {
    for (const po of poDefs) {
      const r = rng();
      if (r < 0.55) continue; // unmapped
      matrixData.push({ coId: co.id, poId: po.id, strength: r < 0.7 ? 1 : r < 0.85 ? 2 : 3 });
    }
  }
  // Guarantee every CO maps somewhere and PO1 is never empty.
  for (const co of coDefs) {
    if (!matrixData.some((m) => m.coId === co.id)) matrixData.push({ coId: co.id, poId: 'po1', strength: 2 });
  }
  if (!matrixData.some((m) => m.poId === 'po1')) matrixData.push({ coId: 'co1', poId: 'po1', strength: 3 });
  await prisma.articulationMatrix.createMany({ data: matrixData });

  // ── enrolments: the whole roster takes the course ─────────────────────
  await prisma.enrolment.createMany({
    data: studentIds.map((_, i) => ({
      id: `enr-${pad(i + 1)}`,
      courseId: 'course-mat301',
      rosterEntryId: `ros-${pad(i + 1)}`,
      batchId: 'batch-2024',
    })),
  });
  const enrolmentIds = studentIds.map((_, i) => `enr-${pad(i + 1)}`);

  // ── assessments ────────────────────────────────────────────────────────
  interface ItemSpec { id: string; label: string; maxMark: number; coId: string | null; sectionId?: string }
  interface AssessmentSpec {
    id: string;
    name: string;
    shape: 'SECTIONED' | 'ITEM_LIST' | 'SINGLE_SCORE';
    scoringRule: 'RUBRIC' | 'COHORT_BAND';
    weightGroup: string;
    sections?: { id: string; name: string }[];
    items: ItemSpec[];
    coTags?: string[];
  }

  const cia = (n: 1 | 2, cos: [string, string, string]): AssessmentSpec => ({
    id: `cia${n}`,
    name: `Internal Test ${n === 1 ? 'I' : 'II'}`,
    shape: 'SECTIONED',
    scoringRule: 'RUBRIC',
    weightGroup: 'internal',
    sections: [
      { id: `cia${n}-secA`, name: 'Section A' },
      { id: `cia${n}-secB`, name: 'Section B' },
      { id: `cia${n}-secC`, name: 'Section C' },
    ],
    items: [
      { id: `cia${n}-q1`, label: 'Q1', maxMark: 2, coId: cos[0], sectionId: `cia${n}-secA` },
      { id: `cia${n}-q2`, label: 'Q2', maxMark: 2, coId: cos[0], sectionId: `cia${n}-secA` },
      { id: `cia${n}-q3`, label: 'Q3', maxMark: 2, coId: cos[1], sectionId: `cia${n}-secA` },
      { id: `cia${n}-q4`, label: 'Q4', maxMark: 2, coId: cos[1], sectionId: `cia${n}-secA` },
      { id: `cia${n}-q5`, label: 'Q5', maxMark: 5, coId: cos[0], sectionId: `cia${n}-secB` },
      { id: `cia${n}-q6`, label: 'Q6', maxMark: 5, coId: cos[1], sectionId: `cia${n}-secB` },
      { id: `cia${n}-q7`, label: 'Q7', maxMark: 10, coId: cos[2], sectionId: `cia${n}-secC` },
    ],
  });

  const specs: AssessmentSpec[] = [
    cia(1, ['co1', 'co2', 'co3']),
    cia(2, ['co3', 'co4', 'co5']),
    {
      id: 'quiz1',
      name: 'Quiz 1',
      shape: 'ITEM_LIST',
      scoringRule: 'RUBRIC',
      weightGroup: 'continuous',
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `quiz1-q${i + 1}`,
        label: `Q${i + 1}`,
        maxMark: 1,
        coId: `co${(i % 5) + 1}`,
      })),
    },
    {
      id: 'assign1',
      name: 'Assignment 1',
      shape: 'ITEM_LIST',
      scoringRule: 'RUBRIC',
      weightGroup: 'continuous',
      // Untagged: contributes to every CO, as the Procedure treats assignments.
      items: [{ id: 'assign1-a1', label: 'Assignment', maxMark: 5, coId: null }],
    },
    {
      id: 'seminar1',
      name: 'Seminar',
      shape: 'SINGLE_SCORE',
      scoringRule: 'RUBRIC',
      weightGroup: 'continuous',
      items: [{ id: 'seminar1-score', label: 'Seminar score', maxMark: 10, coId: null }],
      coTags: ['co4', 'co5'], // multi-CO tag lives on AssessmentCoTag
    },
    {
      id: 'endsem',
      name: 'End-Semester Examination',
      shape: 'SINGLE_SCORE',
      scoringRule: 'COHORT_BAND',
      weightGroup: 'external',
      // Untagged: applies to every CO (§3.1). Total marks only (§4.3).
      items: [{ id: 'endsem-score', label: 'Total', maxMark: 75, coId: null }],
    },
  ];

  for (const [order, spec] of specs.entries()) {
    await prisma.assessment.create({
      data: {
        id: spec.id,
        courseId: 'course-mat301',
        name: spec.name,
        shape: spec.shape,
        scoringRule: spec.scoringRule,
        weightGroup: spec.weightGroup,
        displayOrder: order + 1,
      },
    });
    if (spec.sections) {
      await prisma.section.createMany({
        data: spec.sections.map((s, i) => ({ ...s, assessmentId: spec.id, displayOrder: i + 1 })),
      });
    }
    await prisma.item.createMany({
      data: spec.items.map((item, i) => ({
        id: item.id,
        assessmentId: spec.id,
        sectionId: item.sectionId ?? null,
        label: item.label,
        maxMark: D(item.maxMark),
        coId: item.coId,
        displayOrder: i + 1,
      })),
    });
    if (spec.coTags) {
      await prisma.assessmentCoTag.createMany({
        data: spec.coTags.map((coId) => ({ assessmentId: spec.id, coId })),
      });
    }
  }

  // ── marks: every enrolment × every item, pseudo-random ────────────────
  const markData: Prisma.MarkValueCreateManyInput[] = [];
  for (const spec of specs) {
    for (const item of spec.items) {
      for (const enrolmentId of enrolmentIds) {
        const value = randomMark(item.maxMark);
        markData.push({
          enrolmentId,
          itemId: item.id,
          assessmentId: spec.id,
          courseId: 'course-mat301',
          value: value === null ? null : D(value),
        });
      }
    }
  }
  await prisma.markValue.createMany({ data: markData });

  // ── indirect feedback: CO-wise 3-point counts ─────────────────────────
  await prisma.indirectFeedback.createMany({
    data: coDefs.map((co) => {
      const n3 = 10 + Math.floor(rng() * 20);
      const n2 = 5 + Math.floor(rng() * 12);
      const n1 = Math.floor(rng() * 6);
      return { coId: co.id, n1, n2, n3 };
    }),
  });

  const counts = {
    students: await prisma.student.count(),
    enrolments: await prisma.enrolment.count(),
    assessments: await prisma.assessment.count(),
    items: await prisma.item.count(),
    marks: await prisma.markValue.count(),
    blanks: await prisma.markValue.count({ where: { value: null } }),
  };
  console.log('Seed complete:', counts);
  console.log('Course id: course-mat301 — try `npm run smoke` to run the adapter + engine against it.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
