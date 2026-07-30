'use server';

import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { createJob } from '@/lib/jobs';
import type { ConsolidationResult } from '@/lib/jobs';
import { requireSession } from '@/lib/session';

/**
 * Consolidations are started as background jobs and polled (NFR-2) — the
 * request that starts one returns as soon as the job row exists.
 */

export async function startProgrammeConsolidationAction(programmeId: string): Promise<{ jobId: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'programme.read', programmeId });

  const jobId = await createJob('PROGRAMME_CONSOLIDATION', { programmeId }, user.userId);
  await logAudit({
    actorId: user.userId,
    action: 'CONSOLIDATION_STARTED',
    entityType: 'Programme',
    entityId: programmeId,
    after: { jobId, kind: 'PROGRAMME_CONSOLIDATION' },
  });
  return { jobId };
}

export async function startInstitutionConsolidationAction(): Promise<{ jobId: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'institution.read' });

  const jobId = await createJob('INSTITUTION_CONSOLIDATION', {}, user.userId);
  await logAudit({
    actorId: user.userId,
    action: 'CONSOLIDATION_STARTED',
    entityType: 'Institution',
    entityId: 'institution',
    after: { jobId, kind: 'INSTITUTION_CONSOLIDATION' },
  });
  return { jobId };
}

/** Starts the accreditation bundle (FR-22) as a restartable background job. */
export async function startBundleAction(filter: { semester?: number; batchName?: string }): Promise<{ jobId: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'institution.read' });

  const jobId = await createJob(
    'ACCREDITATION_BUNDLE',
    {
      ...(filter.semester !== undefined ? { semester: filter.semester } : {}),
      ...(filter.batchName !== undefined ? { batchName: filter.batchName } : {}),
    },
    user.userId,
  );
  await logAudit({
    actorId: user.userId,
    action: 'BUNDLE_STARTED',
    entityType: 'Institution',
    entityId: 'institution',
    after: { jobId, filter },
  });
  return { jobId };
}

/**
 * Restarts a failed bundle. Every PDF already written survives on disk,
 * so the run resumes rather than starting over (NFR-4).
 */
export async function restartBundleAction(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'institution.read' });

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: 'No such job.' };
  if (job.status === 'RUNNING') return { ok: false, error: 'That bundle is already running.' };
  if (job.status === 'COMPLETED') return { ok: false, error: 'That bundle already finished.' };

  const { bundleProgressOnDisk } = await import('@/lib/bundle');
  const alreadyWritten = await bundleProgressOnDisk(jobId);

  const { runJob } = await import('@/lib/jobs');
  void runJob(jobId, true).catch(async (err) => {
    await prisma.job
      .update({
        where: { id: jobId },
        data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
      })
      .catch(() => undefined);
  });

  await logAudit({
    actorId: user.userId,
    action: 'BUNDLE_RESTARTED',
    entityType: 'Job',
    entityId: jobId,
    after: { alreadyWritten },
  });
  return { ok: true };
}

/** Full institutional export in open formats (NFR-12), on demand. */
export async function startInstitutionalExportAction(): Promise<{ jobId: string }> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'institution.read' });

  const jobId = await createJob('INSTITUTIONAL_EXPORT', {}, user.userId);
  await logAudit({
    actorId: user.userId,
    action: 'INSTITUTIONAL_EXPORT_STARTED',
    entityType: 'Institution',
    entityId: 'institution',
    after: { jobId },
  });
  return { jobId };
}

export interface BundleResultView {
  fileName: string;
  courseCount: number;
  programmeCount: number;
  skipped: number;
  byteLength: number;
  generatedAt: string;
}

export interface JobStatusView {
  kind: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  progressNote: string | null;
  error: string | null;
  result: ConsolidationResult | null;
  bundle: BundleResultView | null;
}

/** Polled by the consolidation pages. Only the job's own creator or a
 *  reader of the same scope may look; scope was checked at creation, and
 *  the job id is unguessable (cuid). */
export async function getJobStatusAction(jobId: string): Promise<JobStatusView | null> {
  await requireSession();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  const isFileJob = job.kind === 'ACCREDITATION_BUNDLE' || job.kind === 'INSTITUTIONAL_EXPORT';
  return {
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    progressNote: job.progressNote,
    error: job.error,
    result: isFileJob ? null : ((job.result as unknown as ConsolidationResult) ?? null),
    bundle: isFileJob ? ((job.result as unknown as BundleResultView) ?? null) : null,
  };
}
