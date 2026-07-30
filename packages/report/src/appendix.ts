import { ReportDoc, type Cell } from './doc';
import { COLOR, SIZE } from './theme';
import type { AppendixData } from './types';

/**
 * The Procedure appendix (FR-22): the college's ten-step method restated
 * as it was actually applied, followed by the parameters in force for
 * every course in the bundle and the level each was inherited from.
 *
 * The narrative is the Procedure; the tables make it specific, so an
 * assessor never has to ask "but which threshold did THIS course use?".
 */

const SOURCE_LABEL: Record<string, string> = {
  institution: 'Institution',
  programme: 'Programme',
  course: 'Course',
};

const STEPS: [string, string][] = [
  [
    'Step 1 — Map each Course Outcome to the POs and PSOs',
    'Each CO is correlated with every PO/PSO as 1 (low), 2 (medium) or 3 (high). For each PO/PSO a weightage is computed as the mean of the CO strengths mapped to it. An unmapped cell is absent, not zero, and is excluded from that mean.',
  ],
  [
    'Step 2 — Fix the attainment thresholds and rubric',
    'A student attains a question when the mark reaches the threshold, set as a fraction of that question’s maximum. The attainment level of each question is then read from the proportion of students who cleared it, using the band table.',
  ],
  [
    'Step 3 — Score every question',
    'For each item: attempted (the students with a non-blank mark), cleared (those reaching the threshold), percentage = cleared ÷ attempted × 100, and the level read from the bands. A blank is “did not attempt” and is excluded from the denominator; a zero is an attempted mark and is included.',
  ],
  [
    'Step 4 — Aggregate questions to each Course Outcome',
    'Within an assessment, item levels are averaged to the CO. For a sectioned test the mean is taken within each section, then across the sections in which the CO appears — never across sections it is absent from.',
  ],
  [
    'Step 5 — Consolidate within each weight group',
    'A CO’s level for a weight group is the mean of the assessment levels in that group in which the CO appears. A CO assessed in one test carries that test’s value; a CO assessed in several carries their mean.',
  ],
  [
    'Steps 6 and 7 — Continuous and external components',
    'Both follow from Step 5. The continuous group averages the assignments, quizzes and seminars. The external group is the end-semester paper, scored from the distribution of total marks against the cohort bands.',
  ],
  [
    'Step 8 — Indirect attainment',
    'From the CO-wise 3-point student feedback: indirect = (1×n₁ + 2×n₂ + 3×n₃) ÷ N. A CO with no responses yields no indirect value and is computed direct-only, flagged.',
  ],
  [
    'Step 9 — Final CO attainment',
    'Direct is the weighted sum of the group levels using the group weights; where a group did not assess a CO, the remaining weights are renormalised proportionally rather than the missing level being treated as zero. Final = direct weight × direct + indirect weight × indirect.',
  ],
  [
    'Step 10 — Project onto the POs and PSOs',
    'PO attainment = weightage × (mean final CO attainment) ÷ 3 — the Procedure’s method and the reported figure. The CO-weighted alternative Σ(strength × final) ÷ Σ(strength) is computed alongside for comparison only.',
  ],
];

export async function renderAppendix(data: AppendixData): Promise<Buffer> {
  const doc = new ReportDoc(
    {
      title: data.institutionName,
      context: 'Accreditation bundle — appendix',
      subtitle: 'Computational procedure and the parameters applied',
    },
    `Generated ${data.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${data.engineVersion}`,
  );

  doc.title('Appendix — Computational Procedure', 'CO–PO/PSO attainment, and the parameters actually applied');
  doc.paragraph(
    'The following ten steps convert student marks into Programme-Outcome attainment. Every attainment value is ' +
      'expressed on a 0–3 scale. This appendix states the method and then records, course by course, the parameter ' +
      'values that were in force when the figures in this bundle were computed.',
  );

  doc.heading('A. The ten steps');
  for (const [heading, body] of STEPS) {
    doc.ensure(56);
    doc.paragraph(heading, { size: SIZE.subheading });
    doc.paragraph(body, { size: SIZE.body });
    doc.space(2);
  }

  doc.heading('B. Parameters applied, by course');
  doc.paragraph(
    'Where a value was overridden below institution level, the level that supplied it is named. An override at course ' +
      'level records an exception minuted by the Academic Council.',
    { size: SIZE.small, color: COLOR.muted, italic: true },
  );

  for (const course of data.courses) {
    doc.ensure(120);
    doc.paragraph(`${course.code} — ${course.title}  (${course.programmeName})`, { size: SIZE.subheading });

    const source = (field: string): string =>
      course.provenance ? (SOURCE_LABEL[course.provenance[field as keyof typeof course.provenance]] ?? '—') : 'recorded in snapshot';

    const bands = [...course.parameters.bands]
      .sort((a, b) => b.lowerBound - a.lowerBound)
      .map((band) => `≥ ${band.lowerBound}% → ${band.level}`)
      .join(';  ');
    const cohort = [...course.parameters.cohortBands]
      .sort((a, b) => b.level - a.level)
      .map((band) => `≥ ${band.cohortPercent}% of students at ≥ ${band.scorePercent}% → ${band.level}`)
      .join(';  ');
    const weights = Object.entries(course.parameters.weightGroups)
      .map(([group, weight]) => `${group} ${weight}`)
      .join(';  ');

    const rows: Cell[][] = [
      ['Item threshold', `${course.parameters.thresholdFraction} × item maximum`, source('thresholdFraction')],
      ['Attainment bands', bands, source('bands')],
      ['End-semester cohort bands', cohort, source('cohortBands')],
      ['Weight groups', weights, source('weightGroups')],
      [
        'Direct / indirect blend',
        `${course.parameters.directWeight} × direct + ${course.parameters.indirectWeight} × indirect`,
        source('directWeight'),
      ],
      ['Target attainment', String(course.parameters.targetAttainment), source('targetAttainment')],
      ['Feedback response floor', String(course.parameters.feedbackResponseFloor), source('feedbackResponseFloor')],
    ];

    doc.table(
      [
        { header: 'Parameter', width: 130 },
        { header: 'Value applied', width: 250, small: true },
        { header: 'Inherited from', width: 90 },
      ],
      rows,
    );
  }

  return doc.finish();
}
