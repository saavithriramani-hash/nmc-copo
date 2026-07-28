import Link from 'next/link';
import { notFound } from 'next/navigation';
import { institutionParameters } from '@copo/db';
import { InstitutionParameters } from '@/components/InstitutionParameters';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { draftFromParameters } from '@/lib/institutionParams';
import { requireSession } from '@/lib/session';

/**
 * Institution attainment bands and weights (§4.2-§4.4).
 *
 * Editing is `settings.institution.write` — the IQAC alone. Reading
 * follows `institution.read`, so the Principal sees the policy in force
 * without being able to change it. The administrator sees neither: they
 * hold no academic data access at all.
 *
 * These parameters exist only at institution level in the UI. The
 * database and the engine still support programme and course overrides
 * for them — the cascade is one mechanism — but nothing here offers it,
 * so in practice they are set once for the college. The rubric threshold
 * is the deliberate exception, overridable per course by the HoD.
 */
export default async function InstitutionParametersPage() {
  const user = await requireSession();
  if (!(await guard.check(user.userId, { type: 'institution.read' })).allow) notFound();

  const institution = await prisma.institution.findFirst();
  if (!institution) {
    return (
      <p className="text-gray-600">
        No institution record exists yet — an administrator creates it on the{' '}
        <Link href="/admin/departments" className="text-blue-700 hover:underline">
          Departments
        </Link>{' '}
        page.
      </p>
    );
  }

  const canEdit = (await guard.check(user.userId, { type: 'settings.institution.write' })).allow;
  const parameters = institutionParameters(institution);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Attainment parameters</h1>
        <p className="text-xs text-gray-600 max-w-3xl">
          The bands and weights the whole college computes with (§4). Changing them changes every figure that is not
          already locked into a snapshot, across every department — so they are the IQAC&apos;s to set, and every
          change is recorded in the audit log with the complete previous set.
        </p>
      </div>
      <InstitutionParameters initial={draftFromParameters(parameters)} canEdit={canEdit} />
      <p className="text-xs text-gray-500 max-w-3xl">
        The rubric threshold is not here: it is the one parameter a Head of Department may vary for a single course,
        on that course&apos;s Parameters tab, to record a minuted exception. The per-programme target attainment is
        likewise set per programme.
      </p>
    </div>
  );
}
