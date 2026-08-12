import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { renderCourseReport, renderCourseReportDocx } from '../src/index';
import { buildCourseReportData } from './fixture';

/**
 * The Word course report.
 *
 * A .docx is a zip of OOXML, so these tests open it as one and read
 * `word/document.xml` — proving the file is a real Word document that
 * Word will open, not merely a buffer of the right length.
 *
 * The test that matters most is the last one: the Word and PDF versions
 * must state the same figures. Two filed documents disagreeing about an
 * attainment an auditor may question is the failure this whole feature
 * could most plausibly introduce.
 */

async function openDocx(buffer: Buffer): Promise<{ entries: string[]; xml: string; text: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files);
  const xml = await zip.file('word/document.xml')!.async('string');
  // Tags out, runs joined with a space so adjacent cells do not fuse into
  // a word that was never written.
  const text = xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return { entries, xml, text };
}

describe('course report as Word (FR-19)', () => {
  it('produces a real .docx — a zip carrying the OOXML parts Word requires', async () => {
    const buffer = await renderCourseReportDocx(buildCourseReportData());

    // PK\x03\x04: the zip local file header every .docx begins with.
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

    const { entries } = await openDocx(buffer);
    expect(entries).toContain('[Content_Types].xml');
    expect(entries).toContain('word/document.xml');
    expect(entries).toContain('_rels/.rels');
    expect(buffer.byteLength).toBeGreaterThan(4000);
  });

  it('contains every required section (FR-19)', async () => {
    const { text } = await openDocx(await renderCourseReportDocx(buildCourseReportData()));
    expect(text).toContain('MAT301');
    expect(text).toContain('Real Analysis');
    expect(text).toContain('Course details');
    expect(text).toContain('Course outcomes');
    expect(text).toContain('articulation matrix');
    expect(text).toContain('Item-wise analysis');
    expect(text).toContain('Course outcome attainment');
    expect(text).toContain('Programme outcome attainment');
    expect(text).toContain('Gap analysis and action plan');
    expect(text).toContain('Official');
    expect(text).toContain('Secondary');
    expect(text).toContain('Head of the Department');
  });

  it('states the engine’s hand-verified figures', async () => {
    const { text } = await openDocx(await renderCourseReportDocx(buildCourseReportData()));
    // Final CO attainment 2.115 / 2.210 and PO1 official 1.889 (17/9).
    expect(text).toContain('2.115');
    expect(text).toContain('2.210');
    expect(text).toContain('1.889');
  });

  it('agrees with the PDF on every figure it prints', async () => {
    // The point of sharing `fmt`. Both documents are rendered from one
    // `CourseReportData`; each number that appears in the Word file must
    // appear in the PDF, or the two disagree about an approved result.
    const data = buildCourseReportData();
    const { text: word } = await openDocx(await renderCourseReportDocx(data));
    const pdfText = pdfStrings(await renderCourseReport(data));

    // Three-decimal attainment figures — the ones an assessor reads.
    const figures = [...new Set(word.match(/\d+\.\d{3}/g) ?? [])];
    expect(figures.length).toBeGreaterThan(5);
    for (const figure of figures) {
      expect(pdfText, `${figure} appears in the Word report but not in the PDF`).toContain(figure);
    }
  });

  it('keeps computation warnings off the filed document, but states what §5.1 requires', async () => {
    const data = buildCourseReportData();
    data.input.indirect = {};
    data.input.cos.push({ id: 'co4', statement: 'Never assessed', bloomLevels: ['Create'] });
    data.input.poMatrix['co4'] = { po1: 1, po2: null };
    data.cos.push({ id: 'co4', code: 'CO4', statement: 'Never assessed', bloomLevels: ['Create'] });
    data.refs.coCodeById['co4'] = 'CO4';
    const { computeCourse } = await import('@copo/engine');
    data.result = computeCourse(data.input);
    expect(data.result.warnings.length).toBeGreaterThan(0);

    const { text } = await openDocx(await renderCourseReportDocx(data));
    for (const warning of data.result.warnings) {
      expect(text, `warning code ${warning.code} must not be printed`).not.toContain(warning.code);
    }
    // The disclosure §5.1 requires survives, as method rather than warning.
    expect(text).toContain('direct-only');
  });

  it('names a CO that could not be measured, and does not record it as zero (§5.1)', async () => {
    const data = buildCourseReportData();
    // A CO with no attainment at all. Stripping its tags is not enough —
    // the untagged continuous and external assessments apply to every CO,
    // so the fixture would still give it a level. Null is the state the
    // report has to describe: assessed nowhere, and not a zero.
    const co3 = data.result.finalCo.find((row) => row.coId === 'co3')!;
    co3.final = null;

    const { text } = await openDocx(await renderCourseReportDocx(data));
    expect(text).toContain('Not measured');
    expect(text).toContain('CO3');
    expect(text).toContain('not recorded as zero');
  });

  it('discloses a redistributed weight group (§5.1)', async () => {
    const data = buildCourseReportData();
    data.input.parameters = {
      ...data.input.parameters,
      weightGroups: { ...data.input.parameters.weightGroups, practical: 0.2, external: 0.5 },
    };
    const { computeCourse } = await import('@copo/engine');
    data.result = computeCourse(data.input);

    const { text } = await openDocx(await renderCourseReportDocx(data));
    expect(text).toContain('Weight redistribution');
    expect(text).toContain('practical');
    expect(text).not.toContain('EMPTY_WEIGHT_GROUP');
  });

  it('says where the charts are rather than dropping them silently', async () => {
    // A Word file missing its charts with no explanation is
    // indistinguishable from one whose charts failed to render.
    const { text } = await openDocx(await renderCourseReportDocx(buildCourseReportData()));
    expect(text).toContain('PDF version of this report shows');
    expect(text).toContain('bar chart');
    expect(text).toContain('spider chart');
  });

  it('leaves the action plan blank for the faculty to write in', async () => {
    const { text, xml } = await openDocx(await renderCourseReportDocx(buildCourseReportData()));
    expect(text).toContain('Action plan for the next cycle');
    expect(text).toContain('to be completed');
    // Ruled lines to write on: bottom-bordered empty paragraphs.
    expect(xml).toContain('w:bottom');
  });

  it('renders a live (unlocked) course, with no snapshot version claimed', async () => {
    const data = buildCourseReportData();
    data.course.snapshotVersion = null;
    data.course.lockedAt = null;
    data.course.lockedBy = null;
    data.course.status = 'DRAFT';
    const { text } = await openDocx(await renderCourseReportDocx(data));
    expect(text).toContain('live computation');
    expect(text).not.toContain('locked snapshot');
  });

  it('does not let a value that looks like markup change the document', async () => {
    // Course titles and CO statements are typed by a person. A title
    // carrying angle brackets or an ampersand must be escaped into the
    // XML, not injected as markup.
    const data = buildCourseReportData();
    data.course.title = 'Analysis <b>& "Topology"</b>';
    const { xml, text } = await openDocx(await renderCourseReportDocx(data));
    expect(xml).not.toContain('<b>');
    expect(text).toContain('Analysis');
    expect(text).toContain('Topology');
  });
});

/** The visible strings in a pdfkit PDF — enough to compare figures. */
function pdfStrings(buffer: Buffer): string {
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const raw = buffer.toString('latin1');
  const pieces: string[] = [];
  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) continue;
    const chunk = Buffer.from(raw.slice(start, end), 'latin1');
    let content: string;
    try {
      content = zlib.inflateSync(chunk).toString('latin1');
    } catch {
      content = chunk.toString('latin1');
    }
    for (const array of content.matchAll(/\[((?:[^\][])*)\]\s*TJ/g)) {
      let run = '';
      for (const hex of array[1]!.matchAll(/<([0-9a-fA-F]*)>/g)) run += Buffer.from(hex[1]!, 'hex').toString('latin1');
      for (const literal of array[1]!.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) run += literal[1]!.replace(/\\([()\\])/g, '$1');
      if (run) pieces.push(run);
    }
    for (const literal of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')/g)) {
      pieces.push(literal[1]!.replace(/\\([()\\])/g, '$1'));
    }
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) {
      pieces.push(Buffer.from(hex[1]!, 'hex').toString('latin1'));
    }
  }
  return pieces.join(' ');
}
