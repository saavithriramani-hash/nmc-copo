import { NextResponse } from 'next/server';
import { collectHealth } from '@/lib/health';

/**
 * Machine-readable health, for an uptime monitor or a cron check.
 *
 * Deliberately UNAUTHENTICATED but deliberately thin: it reveals only
 * whether the system is healthy, never any academic data. HTTP 200 when
 * healthy or merely warning, 503 when something has failed — so a
 * monitor can alert on the status code alone.
 */
export async function GET(): Promise<Response> {
  try {
    const report = await collectHealth();
    return NextResponse.json(
      {
        status: report.level,
        checkedAt: report.checkedAt,
        checks: report.checks.map((check) => ({ name: check.name, level: check.finding.level, summary: check.finding.summary })),
      },
      { status: report.level === 'fail' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { status: 'fail', error: err instanceof Error ? err.message : String(err) },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
