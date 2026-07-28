'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@copo/db';
import { institutionParameters } from '@copo/db';
import { prisma } from '@/lib/db';
import { guard } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { requireSession } from '@/lib/session';
import { parseParametersDraft, type ParametersDraft } from '@/lib/institutionParams';

/**
 * Institution attainment bands and weights (§4.2-§4.4) —
 * `settings.institution.write`, which the policy grants to the IQAC
 * alone. Not the administrator: accounts and infrastructure are theirs,
 * academic policy is not (separation of duties).
 *
 * These are institution-wide and are edited only here. Programme and
 * course levels carry no UI for them, unlike the rubric threshold.
 *
 * Audit-logged with the complete prior parameter set (FR-17), because
 * every figure the institution has ever reported depends on these
 * numbers and a change must be reconstructable.
 */

export type SettingsResult = { error?: string; errors?: string[]; ok?: boolean; message?: string };

export async function saveInstitutionParametersAction(draft: ParametersDraft): Promise<SettingsResult> {
  const user = await requireSession();
  await guard.require(user.userId, { type: 'settings.institution.write' });

  const institution = await prisma.institution.findFirst();
  if (!institution) return { error: 'No institution record exists yet.' };

  const before = institutionParameters(institution);
  const outcome = parseParametersDraft(draft, before);
  if ('errors' in outcome) return { errors: outcome.errors };
  const next = outcome.parameters;

  await prisma.institution.update({
    where: { id: institution.id },
    data: {
      bands: next.bands as unknown as Prisma.InputJsonValue,
      cohortBands: next.cohortBands as unknown as Prisma.InputJsonValue,
      weightGroups: next.weightGroups as unknown as Prisma.InputJsonValue,
      directWeight: new Prisma.Decimal(next.directWeight),
      indirectWeight: new Prisma.Decimal(next.indirectWeight),
    },
  });

  await logAudit({
    actorId: user.userId,
    action: 'INSTITUTION_PARAMETERS_SAVED',
    entityType: 'Institution',
    entityId: institution.id,
    before: {
      bands: before.bands,
      cohortBands: before.cohortBands,
      weightGroups: before.weightGroups,
      directWeight: before.directWeight,
      indirectWeight: before.indirectWeight,
    },
    after: {
      bands: next.bands,
      cohortBands: next.cohortBands,
      weightGroups: next.weightGroups,
      directWeight: next.directWeight,
      indirectWeight: next.indirectWeight,
    },
  });

  // Nothing derived is stored, so every unlocked course recomputes with
  // these the moment they change.
  revalidatePath('/', 'layout');

  return {
    ok: true,
    message:
      'Saved. Every course that is not locked now computes with these; locked courses keep the values in their snapshots.',
  };
}
