/**
 * Dev smoke test: loads the seeded course through the adapter, runs the
 * engine, and prints the attainment chain. Verifies the PLUMBING
 * (schema → adapter → engine input validation) — it says nothing about
 * calculation correctness, which rests on the engine's hand-computed
 * fixtures alone.
 *
 *   npm run smoke   (requires a migrated, seeded database)
 */
import { computeCourse } from '@copo/engine';
import { createPrismaClient, loadDotEnv } from '../client';
import { loadCourseInput } from '../adapter';

loadDotEnv();
const prisma = createPrismaClient();

async function main(): Promise<void> {
  const course = await prisma.course.findFirstOrThrow({ select: { id: true, code: true, title: true } });
  const { input, parameterResolution, refs } = await loadCourseInput(prisma, course.id);
  const result = computeCourse(input);

  console.log(`\n${course.code} — ${course.title}`);
  console.log('\nParameter provenance (§4):');
  for (const [field, source] of Object.entries(parameterResolution.provenance)) {
    console.log(`  ${field.padEnd(22)} ${source}`);
  }

  console.log('\nFinal CO attainment (Step 9):');
  for (const co of result.finalCo) {
    const code = refs.coCodeById[co.coId] ?? co.coId;
    const fmt = (v: number | null) => (v === null ? '   —' : v.toFixed(2));
    console.log(
      `  ${code.padEnd(5)} direct ${fmt(co.direct)}  indirect ${fmt(co.indirect)}  final ${fmt(co.final)}` +
        (co.belowTarget ? '  (below target)' : ''),
    );
  }

  console.log('\nPO/PSO attainment (Step 10, official | secondary):');
  for (const po of result.po) {
    const code = refs.poCodeById[po.poId] ?? po.poId;
    const fmt = (v: number | null) => (v === null ? '  — ' : v.toFixed(3));
    console.log(`  ${code.padEnd(6)} ${fmt(po.official)} | ${fmt(po.secondary)}`);
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of result.warnings) console.log(`  [${w.severity}] ${w.code}: ${w.message}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
