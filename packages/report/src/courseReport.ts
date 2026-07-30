import { drawCoBars, drawSpider, drawTargetVsAchieved } from './charts/draw';
import { ReportDoc, type Cell, type Column } from './doc';
import { analyseGaps } from './gap';
import { COLOR, CONTENT, SIZE } from './theme';
import type { CourseReportData } from './types';

const fmt = (value: number | null | undefined, dp = 3): string =>
  value === null || value === undefined ? '—' : value.toFixed(dp);
const pct = (value: number | null): string => (value === null ? '—' : `${value.toFixed(1)}%`);

/**
 * The course attainment report (FR-19) — the sheet that is printed,
 * signed and filed for accreditation.
 *
 * Sections in the order an assessor reads them: what the course is, what
 * it set out to achieve (COs), how those map to programme outcomes, the
 * evidence (item-wise analysis), the results (CO then PO/PSO, both
 * methods), and finally the gap analysis with a blank action plan for the
 * faculty to complete.
 */
export async function renderCourseReport(data: CourseReportData): Promise<Buffer> {
  const { course, result, refs } = data;
  const doc = new ReportDoc(
    {
      title: `${course.code} — ${course.title}`,
      context: `${course.programmeName} · ${course.batchName}`,
      subtitle: `Semester ${course.semester} · CO–PO/PSO attainment report`,
    },
    `Generated ${course.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${course.engineVersion} · ${
      course.snapshotVersion === null ? 'live computation' : `locked snapshot v${course.snapshotVersion}`
    }`,
  );

  doc.title('CO – PO / PSO Attainment Report', `${course.departmentName} · ${course.programmeName}`);

  // ── 1. Course details ──
  doc.heading('1. Course details');
  doc.keyValues([
    ['Course code', course.code],
    ['Title', course.title],
    ['Semester', String(course.semester)],
    ['Credits', course.credits ?? '—'],
    ['Batch', course.batchName],
    ['Students enrolled', String(course.enrolmentCount)],
    ['Faculty', course.facultyNames.join(', ') || '—'],
    ['Status', course.snapshotVersion === null ? course.status : `${course.status} (version ${course.snapshotVersion})`],
  ]);
  if (course.lockedAt) {
    doc.paragraph(
      `Approved and locked on ${course.lockedAt.toISOString().slice(0, 10)} by ${course.lockedBy ?? '—'}. The figures below are the immutable record of that approval.`,
      { size: SIZE.small, color: COLOR.muted },
    );
  }


  if (result.warnings.length > 0) {
    doc.paragraph(
      `This course was computed with ${result.warnings.length} warning(s); each is listed in section 8. Every warning has a defined result behind it — no figure was silently set to zero.`,
      { size: SIZE.small, color: COLOR.barBelow },
    );
  }

  // ── 2. Course outcomes ──
  doc.heading('2. Course outcomes');
  doc.table(
    [
      { header: 'CO', width: 42 },
      { header: 'Statement', width: 360, small: true },
      { header: 'Bloom levels', width: 70 },
    ],
    // `?? []` so a snapshot written before COs carried multiple levels
    // renders blank rather than throwing: snapshots are immutable, a
    // database trigger forbids updating them, so old shapes persist.
    data.cos.map((co) => [{ text: co.code, bold: true }, co.statement, (co.bloomLevels ?? []).join(', ')]),
  );

  // ── 3. Articulation matrix ──
  doc.heading('3. CO – PO / PSO articulation matrix (Step 1)');
  const poIds = result.step1.perPo.map((entry) => entry.poId);
  const matrixColumns: Column[] = [
    { header: 'CO', width: 40 },
    ...poIds.map((poId) => ({ header: refs.poCodeById[poId] ?? poId, width: 34, align: 'center' as const })),
  ];
  const matrixRows: Cell[][] = data.input.cos.map((co) => [
    { text: refs.coCodeById[co.id] ?? co.id, bold: true },
    ...poIds.map((poId) => {
      const strength = data.input.poMatrix[co.id]?.[poId] ?? null;
      return strength === null ? '' : String(strength);
    }),
  ]);
  matrixRows.push([
    { text: 'Weightage', bold: true },
    ...result.step1.perPo.map((entry) => ({ text: fmt(entry.weightage, 2), bold: true })),
  ]);
  doc.table(matrixColumns, matrixRows);
  doc.paragraph('Strength 1 = low, 2 = medium, 3 = high. A blank cell is unmapped and is excluded from the weightage.', {
    size: SIZE.small,
    color: COLOR.muted,
    italic: true,
  });

  // ── 4. Item-wise analysis ──
  doc.heading('4. Item-wise analysis (Step 3)');
  for (const assessment of data.input.assessments) {
    const scores = result.itemScores.filter((score) => score.assessmentId === assessment.id);
    const cohortRow = result.assessmentCo.find((row) => row.assessmentId === assessment.id && row.cohort);

    doc.ensure(70);
    doc.paragraph(
      `${assessment.name} — ${assessment.shape}, ${assessment.scoringRule}, weight group “${assessment.weightGroup}”`,
      { size: SIZE.subheading },
    );

    if (cohortRow?.cohort) {
      const cohort = cohortRow.cohort;
      doc.table(
        [
          { header: 'Score cut-off', width: 120 },
          { header: 'Students at or above', width: 110, align: 'center' },
          { header: '% of attempted', width: 90, align: 'center' },
          { header: 'Required', width: 70, align: 'center' },
          { header: 'Level', width: 50, align: 'center' },
        ],
        cohort.bands.map((band) => [
          `≥ ${band.scorePercent}% of ${cohort.maxMark} (${((band.scorePercent / 100) * cohort.maxMark).toFixed(1)})`,
          `${band.studentsAtOrAbove} of ${cohort.attempted}`,
          pct(band.pctOfStudents),
          `≥ ${band.cohortPercent}%`,
          band.passed ? { text: String(band.level), bold: true } : '—',
        ]),
      );
      doc.paragraph(`Attainment level for this assessment: ${cohort.level ?? '—'} (Step 7, §4.3).`, { size: SIZE.small });
      continue;
    }

    doc.table(
      [
        { header: 'Item', width: 60 },
        { header: 'Section', width: 70 },
        { header: 'CO', width: 40 },
        { header: 'Max', width: 34, align: 'right' },
        { header: 'Threshold', width: 52, align: 'right' },
        { header: 'Attempted', width: 56, align: 'right' },
        { header: 'Cleared', width: 48, align: 'right' },
        { header: '% cleared', width: 54, align: 'right' },
        { header: 'Level', width: 40, align: 'center' },
      ],
      scores.map((score) => [
        refs.itemLabelById[score.itemId] ?? score.itemId,
        score.sectionId ? (refs.sectionNameById[score.sectionId] ?? score.sectionId) : '—',
        score.appliesToCoIds.length === data.cos.length
          ? 'all'
          : score.appliesToCoIds.map((coId) => refs.coCodeById[coId] ?? coId).join(', '),
        String(score.maxMark),
        score.thresholdMark.toFixed(2),
        String(score.attempted),
        String(score.cleared),
        pct(score.pct),
        score.level === null ? { text: '—', color: COLOR.faint } : { text: String(score.level), bold: true },
      ]),
    );
  }
  doc.paragraph(
    'Attempted counts non-blank marks only: a blank is “did not attempt” and is excluded from the denominator; a zero is an attempted mark and is included.',
    { size: SIZE.small, color: COLOR.muted, italic: true },
  );

  // ── 5. CO attainment ──
  doc.heading('5. Course outcome attainment (Steps 5–9)', 180);
  const groupIds = Object.keys(result.parameters.weightGroups);
  doc.table(
    [
      { header: 'CO', width: 42 },
      ...groupIds.map((groupId) => ({ header: groupId, width: 60, align: 'right' as const })),
      { header: 'Direct', width: 52, align: 'right' as const },
      { header: 'Indirect', width: 52, align: 'right' as const },
      { header: 'Final', width: 52, align: 'right' as const },
      { header: 'Target', width: 46, align: 'right' as const },
    ],
    result.finalCo.map((co) => [
      { text: refs.coCodeById[co.coId] ?? co.coId, bold: true },
      ...groupIds.map((groupId) => fmt(result.groupCo.find((g) => g.groupId === groupId && g.coId === co.coId)?.level ?? null)),
      fmt(co.direct),
      co.directOnly ? 'direct-only' : fmt(co.indirect),
      { text: fmt(co.final), bold: true, color: co.belowTarget ? COLOR.barBelow : COLOR.ink },
      fmt(co.targetAttainment, 2),
    ]),
  );
  doc.paragraph(
    `Final = ${result.parameters.directWeight} × direct + ${result.parameters.indirectWeight} × indirect (Step 9). ` +
      'Direct is the weighted mean of the group levels over the groups that assessed the CO.',
    { size: SIZE.small, color: COLOR.muted, italic: true },
  );

  // CO bar chart with the target rule.
  doc.ensure(190);
  const target = result.parameters.targetAttainment;
  drawCoBars(
    doc.pdf,
    { x: CONTENT.left + 24, y: doc.cursor + 6, width: CONTENT.width - 80, height: 130 },
    result.finalCo.map((co) => ({ label: refs.coCodeById[co.coId] ?? co.coId, value: co.final })),
    { target, caption: 'Final CO attainment against the programme target. Hatched bars fall below target.' },
  );
  doc.space(178);

  // ── 6. PO/PSO attainment ──
  doc.heading('6. Programme outcome attainment (Step 10)', 200);
  doc.table(
    [
      { header: 'PO / PSO', width: 60 },
      { header: 'Statement', width: 230, small: true },
      { header: 'Weightage', width: 60, align: 'right' },
      { header: 'Official', width: 56, align: 'right' },
      { header: 'Secondary', width: 60, align: 'right' },
    ],
    result.po.map((po) => {
      const statement = data.pos.find((entry) => entry.id === po.poId)?.statement ?? '';
      return [
        { text: refs.poCodeById[po.poId] ?? po.poId, bold: true },
        statement,
        fmt(po.weightage, 2),
        { text: fmt(po.official), bold: true },
        fmt(po.secondary),
      ];
    }),
  );
  doc.paragraph(
    'Official = weightage × (mean final CO attainment) ÷ 3 — the Procedure’s method and the reported figure. ' +
      'Secondary = Σ(strength × final) ÷ Σ(strength), the CO-weighted alternative, shown for comparison only.',
    { size: SIZE.small, color: COLOR.muted, italic: true },
  );

  doc.ensure(230);
  const spiderCenterY = doc.cursor + 105;
  drawSpider(
    doc.pdf,
    { x: CONTENT.left + CONTENT.width / 2, y: spiderCenterY },
    82,
    result.po.map((po) => ({ label: refs.poCodeById[po.poId] ?? po.poId, value: po.official })),
    3,
  );
  doc.space(215);

  // ── 7. Gap analysis ──
  doc.heading('7. Gap analysis and action plan (§4.5)', 160);
  const analysis = analyseGaps(
    data.cos.map((co) => ({
      code: co.code,
      statement: co.statement,
      final: result.finalCo.find((row) => row.coId === co.id)?.final ?? null,
    })),
    target,
  );

  doc.paragraph(
    `Target ${target.toFixed(2)}. ${analysis.met.length} CO(s) met the target, ${analysis.below.length} fell below` +
      (analysis.unmeasured.length > 0 ? `, and ${analysis.unmeasured.length} could not be measured.` : '.'),
  );

  doc.ensure(170);
  drawTargetVsAchieved(
    doc.pdf,
    { x: CONTENT.left + 24, y: doc.cursor + 6, width: CONTENT.width - 60, height: 120 },
    data.cos.map((co) => ({
      label: co.code,
      achieved: result.finalCo.find((row) => row.coId === co.id)?.final ?? null,
      target,
    })),
  );
  doc.space(168);

  if (analysis.below.length > 0) {
    doc.table(
      [
        { header: 'CO', width: 40 },
        { header: 'Statement', width: 190, small: true },
        { header: 'Target', width: 44, align: 'right' },
        { header: 'Achieved', width: 52, align: 'right' },
        { header: 'Gap', width: 42, align: 'right' },
        { header: 'Proposed action (to be completed)', width: 140, small: true },
      ],
      analysis.below.map((row) => [
        { text: row.code, bold: true },
        row.statement,
        row.target.toFixed(2),
        { text: row.achieved.toFixed(3), color: COLOR.barBelow },
        { text: row.gap.toFixed(3), bold: true, color: COLOR.barBelow },
        '',
      ]),
    );
  } else {
    doc.paragraph('Every measured course outcome met the target.', { size: SIZE.body });
  }

  if (analysis.unmeasured.length > 0) {
    doc.paragraph(
      `Not measured: ${analysis.unmeasured.map((row) => row.code).join(', ')}. These outcomes were assessed nowhere, so no attainment could be computed — they are not recorded as zero.`,
      { size: SIZE.small, color: COLOR.barBelow },
    );
  }

  doc.paragraph('Action plan for the next cycle (to be completed by the course faculty):', { size: SIZE.subheading });
  doc.ruledLines(6);

  // ── 8. Warnings ──
  if (result.warnings.length > 0) {
    doc.heading('8. Computation warnings');
    doc.table(
      [
        { header: 'Code', width: 130 },
        { header: 'Detail', width: 340, small: true },
      ],
      result.warnings.map((warning) => [{ text: warning.code, bold: true }, warning.message]),
    );
  }

  doc.space(6);
  doc.signatures(['Course faculty', 'Head of the Department', 'IQAC']);

  return doc.finish();
}
