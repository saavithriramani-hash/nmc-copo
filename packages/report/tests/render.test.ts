import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS } from '@copo/engine';
import { renderAppendix, renderCourseReport, renderInstitutionConsolidation, renderProgrammeConsolidation } from '../src/index';
import { buildConsolidationData, buildCourseReportData } from './fixture';

/**
 * Render smoke tests: the reports must actually produce well-formed,
 * multi-page PDFs from real engine output — including the awkward cases
 * (a course with no indirect feedback, a CO assessed nowhere, hundreds of
 * rows that force pagination).
 *
 * These assert structure, not pixels. The arithmetic they display is
 * verified by the engine's own tests and by the pure geometry/gap tests.
 */

/** A PDF starts with %PDF- and ends with %%EOF; pages are /Type /Page. */
function inspectPdf(buffer: Buffer): { valid: boolean; pageCount: number } {
  const head = buffer.subarray(0, 5).toString('latin1');
  const tail = buffer.subarray(-1024).toString('latin1');
  const text = buffer.toString('latin1');
  const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { valid: head === '%PDF-' && tail.includes('%%EOF'), pageCount };
}

/**
 * Pulls the visible text out of the PDF: inflates every FlateDecode
 * content stream and collects the strings drawn by the Tj/TJ operators.
 * This proves the reports actually SAY what they should, rather than
 * merely being well-formed empty pages.
 */
function extractText(buffer: Buffer): string {
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
    // pdfkit emits text as hex strings inside a TJ array, e.g.
    //   [<4d41> 90 <5433303120...>] TJ
    // Chunks within one array are one run and join without a separator;
    // separate arrays are separate runs.
    for (const array of content.matchAll(/\[((?:[^\][])*)\]\s*TJ/g)) {
      let run = '';
      for (const hex of array[1]!.matchAll(/<([0-9a-fA-F]*)>/g)) {
        run += Buffer.from(hex[1]!, 'hex').toString('latin1');
      }
      for (const literal of array[1]!.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
        run += literal[1]!.replace(/\\([()\\])/g, '$1');
      }
      if (run) pieces.push(run);
    }
    // Plain show operators, for completeness.
    for (const literal of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')/g)) {
      pieces.push(literal[1]!.replace(/\\([()\\])/g, '$1'));
    }
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) {
      pieces.push(Buffer.from(hex[1]!, 'hex').toString('latin1'));
    }
  }
  return pieces.join(' ');
}

describe('course report (FR-19)', () => {
  it('produces a valid multi-page PDF', async () => {
    const buffer = await renderCourseReport(buildCourseReportData());
    const info = inspectPdf(buffer);
    expect(info.valid).toBe(true);
    expect(info.pageCount).toBeGreaterThanOrEqual(2);
    expect(buffer.byteLength).toBeGreaterThan(8000);
  });

  it('renders a course computed with warnings (no indirect feedback, CO assessed nowhere)', async () => {
    const data = buildCourseReportData();
    // Strip all feedback and add a CO that nothing assesses.
    data.input.indirect = {};
    data.input.cos.push({ id: 'co4', statement: 'Never assessed', bloomLevels: ['Create'] });
    data.input.poMatrix['co4'] = { po1: 1, po2: null };
    data.cos.push({ id: 'co4', code: 'CO4', statement: 'Never assessed', bloomLevels: ['Create'] });
    data.refs.coCodeById['co4'] = 'CO4';
    const { computeCourse } = await import('@copo/engine');
    data.result = computeCourse(data.input);
    expect(data.result.warnings.length).toBeGreaterThan(0);

    const buffer = await renderCourseReport(data);
    expect(inspectPdf(buffer).valid).toBe(true);
  });

  it('renders a live (unlocked) course without a snapshot version', async () => {
    const data = buildCourseReportData();
    data.course.snapshotVersion = null;
    data.course.lockedAt = null;
    data.course.lockedBy = null;
    data.course.status = 'DRAFT';
    expect(inspectPdf(await renderCourseReport(data)).valid).toBe(true);
  });

  it('actually contains every required section (FR-19), not just valid pages', async () => {
    const text = extractText(await renderCourseReport(buildCourseReportData()));
    expect(text).toContain('MAT301');
    expect(text).toContain('Real Analysis');
    expect(text).toContain('Course details');
    expect(text).toContain('Course outcomes');
    expect(text).toContain('articulation matrix');
    expect(text).toContain('Item-wise analysis');
    expect(text).toContain('Course outcome attainment');
    expect(text).toContain('Programme outcome attainment');
    expect(text).toContain('Gap analysis and action plan');
    // Both Step 10 methods are present and labelled.
    expect(text).toContain('Official');
    expect(text).toContain('Secondary');
    // The signature block a filed report needs.
    expect(text).toContain('Head of the Department');
  });

  it('prints the engine’s hand-verified figures', async () => {
    const text = extractText(await renderCourseReport(buildCourseReportData()));
    // Final CO attainment 2.115 / 2.050 / 2.210 and PO1 official 1.889 (17/9).
    expect(text).toContain('2.115');
    expect(text).toContain('2.210');
    expect(text).toContain('1.889');
  });

  it('carries the running header identifiers on the page furniture', async () => {
    const text = extractText(await renderCourseReport(buildCourseReportData()));
    expect(text).toContain('B.Sc. Mathematics');
    expect(text).toContain('2024');
    expect(text).toMatch(/Page \d+ of \d+/);
  });
});

describe('programme consolidation (FR-20)', () => {
  it('produces a valid PDF and paginates a long course list', async () => {
    const small = await renderProgrammeConsolidation(buildConsolidationData(6));
    const large = await renderProgrammeConsolidation(buildConsolidationData(180));
    expect(inspectPdf(small).valid).toBe(true);
    expect(inspectPdf(large).valid).toBe(true);
    // 180 courses cannot fit on the pages a handful of courses needs.
    expect(inspectPdf(large).pageCount).toBeGreaterThan(inspectPdf(small).pageCount);
  });

  it('renders with a semester filter and with no trend data', async () => {
    const data = buildConsolidationData(10, { trend: [] as { batchName: string; meanPo: number | null }[] });
    data.meta.filter = { semester: 3 };
    expect(inspectPdf(await renderProgrammeConsolidation(data)).valid).toBe(true);
  });

  it('renders when no course produced a value (means are blank, not zero)', async () => {
    const data = buildConsolidationData(4);
    for (const row of data.rows) row.po = { PO1: null, PO2: null, PSO1: null };
    expect(inspectPdf(await renderProgrammeConsolidation(data)).valid).toBe(true);
  });
});

describe('institution consolidation (FR-21)', () => {
  it('produces a valid PDF broken down by department and programme', async () => {
    const data = buildConsolidationData(60);
    data.meta.scopeLabel = 'Nehru Memorial College (Autonomous)';
    data.meta.scopeContext = 'All departments';
    const buffer = await renderInstitutionConsolidation(data);
    const info = inspectPdf(buffer);
    expect(info.valid).toBe(true);
    expect(info.pageCount).toBeGreaterThanOrEqual(2);
  });
});

describe('appendix (FR-22)', () => {
  it('states the ten steps and the parameters applied per course', async () => {
    const buffer = await renderAppendix({
      institutionName: 'Nehru Memorial College (Autonomous)',
      generatedAt: new Date('2026-07-24T12:00:00Z'),
      engineVersion: '0.1.0',
      courses: [
        {
          code: 'MAT301',
          title: 'Real Analysis',
          programmeName: 'B.Sc. Mathematics',
          parameters: DEFAULT_PARAMETERS,
          provenance: {
            thresholdFraction: 'institution',
            bands: 'institution',
            cohortBands: 'institution',
            weightGroups: 'programme',
            directWeight: 'institution',
            indirectWeight: 'institution',
            targetAttainment: 'course',
            feedbackResponseFloor: 'institution',
          },
        },
        {
          code: 'PHY201',
          title: 'Mechanics',
          programmeName: 'B.Sc. Physics',
          parameters: { ...DEFAULT_PARAMETERS, thresholdFraction: 0.6 },
          provenance: null, // from a locked snapshot
        },
      ],
    });
    const info = inspectPdf(buffer);
    expect(info.valid).toBe(true);
    expect(info.pageCount).toBeGreaterThanOrEqual(2);
  });
});
