import { notFound } from 'next/navigation';
import { ConsolidationRunner } from '@/components/ConsolidationRunner';
import { guard } from '@/lib/authz';
import { requireSession } from '@/lib/session';

/** Institution-level consolidation for the IQAC (FR-21), as a background job. */
export default async function InstitutionPage() {
  const user = await requireSession();
  if (!(await guard.check(user.userId, { type: 'institution.read' })).allow) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Institution consolidation</h1>
      <p className="text-sm text-gray-700">
        PO/PSO attainment across every programme and department. This computes every course in the institution, so it
        runs in the background with a progress indicator — leave the page and come back if you prefer.
      </p>
      <ConsolidationRunner scope={{ kind: 'institution' }} />
    </div>
  );
}
