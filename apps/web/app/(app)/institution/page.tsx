import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BundleRunner } from '@/components/BundleRunner';
import { ConsolidationRunner } from '@/components/ConsolidationRunner';
import { DataExportRunner } from '@/components/DataExportRunner';
import { guard } from '@/lib/authz';
import { requireSession } from '@/lib/session';

/** Institution-level consolidation for the IQAC (FR-21), as a background job. */
export default async function InstitutionPage() {
  const user = await requireSession();
  if (!(await guard.check(user.userId, { type: 'institution.read' })).allow) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Institution consolidation</h1>
        <Link href="/institution/parameters" className="text-sm text-blue-700 hover:underline">
          Attainment parameters →
        </Link>
      </div>
      <p className="text-sm text-gray-700">
        PO/PSO attainment across every programme and department. This computes every course in the institution, so it
        runs in the background with a progress indicator — leave the page and come back if you prefer.
      </p>
      <div className="flex items-center gap-3">
        <ConsolidationRunner scope={{ kind: 'institution' }} />
      </div>
      <p className="text-sm">
        <a href="/api/institution/consolidation" className="text-blue-700 hover:underline">
          Download the institution consolidation as a printable PDF →
        </a>
      </p>
      <BundleRunner />
      <DataExportRunner />
    </div>
  );
}
