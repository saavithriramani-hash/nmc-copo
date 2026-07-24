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

export interface JobStatusView {
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  progressNote: string | null;
  error: string | null;
  result: ConsolidationResult | null;
}

/** Polled by the consolidation pages. Only the job's own creator or a
 *  reader of the same scope may look; scope was checked at creation, and
 *  the job id is unguessable (cuid). */
export async function getJobStatusAction(jobId: string): Promise<JobStatusView | null> {
  await requireSession();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  return {
    status: job.status,
    progress: job.progress,
    progressNote: job.progressNote,
    error: job.error,
    result: (job.result as unknown as ConsolidationResult) ?? null,
  };
}
