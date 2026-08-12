import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { fmt, pct } from './format';
import { analyseGaps } from './gap';
import type { CourseReportData } from './types';

/**
 * The course attainment report as a Word document (FR-19, extended).
 *
 * WHY A THIRD FORMAT. The PDF is the filed document and the Excel is the
 * departmental workbook; neither can be edited by the person who has to
 * write the action plan. §4.5 requires a gap analysis with a plan for
 * each CO below target, and until now that meant printing the PDF and
 * writing on it by hand, or retyping the report into Word to fold it
 * into a NAAC or NBA submission. This is the same report, editable.
 *
 * IT IS NOT A SECOND SOURCE OF TRUTH. Every figure comes from the same
 * `CourseReportData` the PDF renders, formatted through the same `fmt`
 * and `pct`, so the two documents cannot disagree about a number. What
 * differs is only what a word processor can carry.
 *
 * WHAT IS NOT HERE: the charts. The PDF draws its bars and spider as
 * vectors with pdfkit, and there is no equivalent that does not mean
 * rasterising images inside the container. Every figure the charts
 * depict is in the tables beside them, and the document says so where
 * they would have appeared — a reader is told what is missing rather
 * than left to wonder whether the section failed to render.
 */
export async function renderCourseReportDocx(data: CourseReportData): Promise<Buffer> {
  const { course, result, refs } = data;
  const target = result.parameters.targetAttainment;
  const children: (Paragraph | Table)[] = [];

  // ── title block ──
  children.push(
    heading('CO – PO / PSO Attainment Report', HeadingLevel.TITLE),
    centred(`${course.departmentName} · ${course.programmeName}`),
    centred(`${course.code} — ${course.title}`, { bold: true }),
    centred(`${course.batchName} · Semester ${course.semester}`),
    note(
      `Generated ${course.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · engine ${course.engineVersion} · ` +
        (course.snapshotVersion === null ? 'live computation' : `locked snapshot v${course.snapshotVersion}`),
    ),
  );

  // ── 1. course details ──
  children.push(heading('1. Course details'));
  children.push(
    keyValueTable([
      ['Course code', course.code],
      ['Title', course.title],
      ['Semester', String(course.semester)],
      ['Credits', course.credits ?? '—'],
      ['Batch', course.batchName],
      ['Students enrolled', String(course.enrolmentCount)],
      ['Faculty', course.facultyNames.join(', ') || '—'],
      ['Status', course.snapshotVersion === null ? course.status : `${course.status} (version ${course.snapshotVersion})`],
    ]),
  );
  if (course.lockedAt) {
    children.push(
      note(
        `Approved and locked on ${course.lockedAt.toISOString().slice(0, 10)} by ${course.lockedBy ?? '—'}. ` +
          'The figures below are the immutable record of that approval.',
      ),
    );
  }

  // ── 2. course outcomes ──
  children.push(heading('2. Course outcomes'));
  children.push(
    table(
      ['CO', 'Statement', 'Bloom levels'],
      // `?? []` for snapshots written before a CO carried several Bloom
      // levels: a snapshot is immutable, so the old shape persists.
      data.cos.map((co) => [bold(co.code), co.statement, (co.bloomLevels ?? []).join(', ')]),
      [12, 68, 20],
    ),
  );

  // ── 3. articulation matrix ──
  children.push(heading('3. CO – PO / PSO articulation matrix (Step 1)'));
  const poIds = result.step1.perPo.map((entry) => entry.poId);
  const matrixWidths = [14, ...poIds.map(() => 86 / Math.max(poIds.length, 1))];
  children.push(
    table(
      ['CO', ...poIds.map((poId) => refs.poCodeById[poId] ?? poId)],
      [
        ...data.input.cos.map((co) => [
          bold(refs.coCodeById[co.id] ?? co.id),
          ...poIds.map((poId) => {
            const strength = data.input.poMatrix[co.id]?.[poId] ?? null;
            return strength === null ? '' : String(strength);
          }),
        ]),
        [bold('Weightage'), ...result.step1.perPo.map((entry) => bold(fmt(entry.weightage, 2)))],
      ],
      matrixWidths,
      AlignmentType.CENTER,
    ),
  );
  children.push(
    note('Strength 1 = low, 2 = medium, 3 = high. A blank cell is unmapped and is excluded from the weightage.'),
  );

  // ── 4. item-wise analysis ──
  children.push(heading('4. Item-wise analysis (Step 3)'));
  for (const assessment of data.input.assessments) {
    const scores = result.itemScores.filter((score) => score.assessmentId === assessment.id);
    const cohortRow = result.assessmentCo.find((row) => row.assessmentId === assessment.id && row.cohort);

    children.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [
          new TextRun({
            text: `${assessment.name} — ${assessment.shape}, ${assessment.scoringRule}, weight group “${assessment.weightGroup}”`,
            bold: true,
            size: 20,
          }),
        ],
      }),
    );

    if (cohortRow?.cohort) {
      const cohort = cohortRow.cohort;
      children.push(
        table(
          ['Score cut-off', 'Students at or above', '% of attempted', 'Required', 'Level'],
          cohort.bands.map((band) => [
            `≥ ${band.scorePercent}% of ${cohort.maxMark} (${((band.scorePercent / 100) * cohort.maxMark).toFixed(1)})`,
            `${band.studentsAtOrAbove} of ${cohort.attempted}`,
            pct(band.pctOfStudents),
            `≥ ${band.cohortPercent}%`,
            band.passed ? bold(String(band.level)) : '—',
          ]),
          [32, 22, 18, 15, 13],
        ),
      );
      children.push(note(`Attainment level for this assessment: ${cohort.level ?? '—'} (Step 7, §4.3).`));
      continue;
    }

    children.push(
      table(
        ['Item', 'Section', 'CO', 'Max', 'Threshold', 'Attempted', 'Cleared', '% cleared', 'Level'],
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
          score.level === null ? '—' : bold(String(score.level)),
        ]),
        [14, 13, 12, 8, 11, 12, 10, 11, 9],
      ),
    );
  }
  children.push(
    note(
      'Attempted counts non-blank marks only: a blank is “did not attempt” and is excluded from the denominator; a zero is an attempted mark and is included.',
    ),
  );

  // ── 5. CO attainment ──
  children.push(heading('5. Course outcome attainment (Steps 5–9)'));
  const groupIds = Object.keys(result.parameters.weightGroups);
  children.push(
    table(
      ['CO', ...groupIds, 'Direct', 'Indirect', 'Final', 'Target'],
      result.finalCo.map((co) => [
        bold(refs.coCodeById[co.coId] ?? co.coId),
        ...groupIds.map((groupId) =>
          fmt(result.groupCo.find((g) => g.groupId === groupId && g.coId === co.coId)?.level ?? null),
        ),
        fmt(co.direct),
        // "direct-only" rather than a dash: §5.1 requires the report to
        // say a CO carried no indirect feedback, not merely to omit it.
        co.directOnly ? 'direct-only' : fmt(co.indirect),
        bold(fmt(co.final)),
        fmt(co.targetAttainment, 2),
      ]),
      undefined,
      AlignmentType.RIGHT,
    ),
  );
  children.push(
    note(
      `Final = ${result.parameters.directWeight} × direct + ${result.parameters.indirectWeight} × indirect (Step 9). ` +
        'Direct is the weighted mean of the group levels over the groups that assessed the CO.',
    ),
  );

  // §5.1 requires the REPORT to disclose a redistributed weight, as
  // method rather than as a warning — so it must appear here too, or the
  // Word version would be a quieter document than the PDF.
  const redistributed = [
    ...new Map(
      result.finalCo
        .flatMap((co) => co.groupTerms)
        .filter((term) => term.weightUsed !== term.declaredWeight)
        .map((term) => [term.groupId, term] as const),
    ).values(),
  ];
  if (redistributed.length > 0) {
    children.push(
      note(
        'Weight redistribution (§5.1): ' +
          redistributed
            .map((term) => `“${term.groupId}” declared ${term.declaredWeight}, applied ${fmt(term.weightUsed, 3)}`)
            .join('; ') +
          '. A declared group that no assessment belongs to has its weight shared proportionally across the groups that were assessed, so the weights still sum to 1.',
      ),
    );
  }
  children.push(chartNote('a bar chart of final CO attainment against the target'));

  // ── 6. PO/PSO attainment ──
  children.push(heading('6. Programme outcome attainment (Step 10)'));
  children.push(
    table(
      ['PO / PSO', 'Statement', 'Weightage', 'Official', 'Secondary'],
      result.po.map((po) => [
        bold(refs.poCodeById[po.poId] ?? po.poId),
        data.pos.find((entry) => entry.id === po.poId)?.statement ?? '',
        fmt(po.weightage, 2),
        bold(fmt(po.official)),
        fmt(po.secondary),
      ]),
      [14, 46, 13, 13, 14],
    ),
  );
  children.push(
    note(
      'Official = weightage × (mean final CO attainment) ÷ 3 — the Procedure’s method and the reported figure. ' +
        'Secondary = Σ(strength × final) ÷ Σ(strength), the CO-weighted alternative, shown for comparison only.',
    ),
  );
  children.push(chartNote('a spider chart of PO/PSO attainment'));

  // ── 7. gap analysis ──
  children.push(heading('7. Gap analysis and action plan (§4.5)'));
  const analysis = analyseGaps(
    data.cos.map((co) => ({
      code: co.code,
      statement: co.statement,
      final: result.finalCo.find((row) => row.coId === co.id)?.final ?? null,
    })),
    target,
  );
  children.push(
    body(
      `Target ${target.toFixed(2)}. ${analysis.met.length} CO(s) met the target, ${analysis.below.length} fell below` +
        (analysis.unmeasured.length > 0 ? `, and ${analysis.unmeasured.length} could not be measured.` : '.'),
    ),
  );

  if (analysis.below.length > 0) {
    children.push(
      table(
        ['CO', 'Statement', 'Target', 'Achieved', 'Gap', 'Proposed action (to be completed)'],
        analysis.below.map((row) => [
          bold(row.code),
          row.statement,
          row.target.toFixed(2),
          row.achieved.toFixed(3),
          bold(row.gap.toFixed(3)),
          '',
        ]),
        [8, 32, 10, 11, 9, 30],
      ),
    );
  } else {
    children.push(body('Every measured course outcome met the target.'));
  }

  if (analysis.unmeasured.length > 0) {
    children.push(
      body(
        `Not measured: ${analysis.unmeasured.map((row) => row.code).join(', ')}. These outcomes were assessed nowhere, ` +
          'so no attainment could be computed — they are not recorded as zero.',
      ),
    );
  }

  children.push(
    new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [
        new TextRun({ text: 'Action plan for the next cycle (to be completed by the course faculty):', bold: true, size: 20 }),
      ],
    }),
  );
  // Ruled lines rather than empty space: this is the half of the document
  // the faculty are meant to write in, and in Word they type over them.
  for (let i = 0; i < 6; i++) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 4 } },
        children: [new TextRun({ text: '', size: 20 })],
      }),
    );
  }

  children.push(signatures(['Course faculty', 'Head of the Department', 'IQAC']));

  const doc = new Document({
    creator: 'CO–PO Attainment',
    title: `${course.code} — ${course.title} — CO–PO attainment report`,
    description: `CO–PO/PSO attainment, ${course.programmeName}, ${course.batchName}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [
      {
        properties: {},
        footers: { default: new Footer({ children: [footerLine(course.code)] }) },
        children,
      },
    ],
  });

  // toBuffer(), not toBlob(): this runs on the server and the route hands
  // the bytes straight to the response.
  return Buffer.from(await Packer.toBuffer(doc));
}

// ── small builders ───────────────────────────────────────────────────────

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

/**
 * A cell is text, or text marked bold. Deliberately a type rather than a
 * marker prefix inside the string: these values include course titles and
 * CO statements typed by a person, and any sentinel one of them happened
 * to begin with would silently change the document.
 */
type DocxCell = string | { text: string; bold: true };
const bold = (text: string): DocxCell => ({ text, bold: true });

/*
 * `exactOptionalPropertyTypes` is on, so an optional property may be
 * absent but never explicitly `undefined`. Hence the conditional spreads
 * below rather than `align: align` — the tidier-looking form does not
 * compile, and silencing it with a cast would hide a real class of typo.
 */
function runsFor(value: DocxCell, align?: Align): Paragraph {
  const isBold = typeof value !== 'string';
  return new Paragraph({
    ...(align === undefined ? {} : { alignment: align }),
    children: [new TextRun({ text: isBold ? value.text : value, bold: isBold, size: 18 })],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 300, after: 140 },
    ...(level === HeadingLevel.TITLE ? { alignment: AlignmentType.CENTER } : {}),
    children: [new TextRun({ text, bold: true })],
  });
}

const centred = (text: string, opts: { bold?: boolean } = {}): Paragraph =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: opts.bold === true, size: 22 })],
  });

const body = (text: string): Paragraph =>
  new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text, size: 20 })] });

/** The small italic grey line that explains the table above it. */
const note = (text: string): Paragraph =>
  new Paragraph({
    spacing: { before: 80, after: 160 },
    children: [new TextRun({ text, size: 16, italics: true, color: '666666' })],
  });

/**
 * Says where a chart stands in the PDF. Without this the Word document
 * looks the same as one whose chart failed to render.
 */
const chartNote = (what: string): Paragraph =>
  new Paragraph({
    spacing: { before: 80, after: 200 },
    children: [
      new TextRun({
        text: `[The PDF version of this report shows ${what} here. The figures it depicts are in the table above.]`,
        size: 16,
        italics: true,
        color: '888888',
      }),
    ],
  });

function footerLine(courseCode: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: `${courseCode} · CO–PO/PSO attainment report · page `, size: 16, color: '666666' }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '666666' }),
      new TextRun({ text: ' of ', size: 16, color: '666666' }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '666666' }),
    ],
  });
}

/** An absent width lets Word size the column; it is never sent as zero. */
const widthOf = (pct: number | undefined) =>
  pct === undefined ? {} : { width: { size: pct, type: WidthType.PERCENTAGE } };

function cell(value: DocxCell, widthPct: number | undefined, align?: Align): TableCell {
  return new TableCell({
    ...widthOf(widthPct),
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [runsFor(value, align)],
  });
}

function table(headers: string[], rows: DocxCell[][], widths?: number[], bodyAlign?: Align): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        // Repeats on every page, so a long item-wise table stays readable
        // where it breaks across the fold.
        tableHeader: true,
        children: headers.map(
          (header, i) =>
            new TableCell({
              ...widthOf(widths?.[i]),
              shading: { fill: 'EFEFEF' },
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: header, bold: true, size: 18 })],
                }),
              ],
            }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            // The first column is a label (a CO code, an item); the
            // figures after it take the table's alignment.
            children: row.map((value, i) => cell(value, widths?.[i], i === 0 ? undefined : bodyAlign)),
          }),
      ),
    ],
  });
}

function keyValueTable(pairs: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: pairs.map(
      ([key, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 28, type: WidthType.PERCENTAGE },
              shading: { fill: 'F7F7F7' },
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              children: [new Paragraph({ children: [new TextRun({ text: key, bold: true, size: 18 })] })],
            }),
            cell(value, 72),
          ],
        }),
    ),
  });
}

/** The three blocks the filed report is signed in. */
function signatures(labels: string[]): Table {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [
      new TableRow({
        children: labels.map(
          (label) =>
            new TableCell({
              width: { size: Math.floor(100 / labels.length), type: WidthType.PERCENTAGE },
              // Space above the rule, for a real signature.
              margins: { top: 600, bottom: 40, left: 80, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  border: { top: { style: BorderStyle.SINGLE, size: 4, color: '888888', space: 6 } },
                  children: [new TextRun({ text: label, size: 18 })],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}
