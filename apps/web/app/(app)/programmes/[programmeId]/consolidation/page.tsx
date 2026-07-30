import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsolidationRunner } from '@/components/ConsolidationRunner';
import { guard } from '@/lib/authz';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/session';

/** Programme-level consolidation (FR-20), run as a background job. */
export default async function ProgrammeConsolidationPage({ params }: { params: Promise<{ programmeId: string }> }) {
  const user = await requireSession();
  const { programmeId } = await params;
  if (!(await guard.check(user.userId, { type: 'programme.read', programmeId })).allow) notFound();

  const programme = await prisma.programme.findUniqueOrThrow({
    where: { id: programmeId },
    select: { name: true, department: { select: { name: true } }, _count: { select: { outcomes: true } } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Programme consolidation — {programme.name}</h1>
        <p className="text-xs text-gray-600">
          {programme.department.name} ·{' '}
          <Link href={`/programmes/${programmeId}`} className="text-blue-700 hover:underline">programme setup</Link>
        </p>
      </div>
      <p className="text-sm text-gray-700">
        PO/PSO attainment across every course of this programme. Each course is computed from its current marks; locked
        courses are computed the same way, so the table always reflects the marks as they stand.
      </p>
      <ConsolidationRunner scope={{ kind: 'programme', programmeId }} />
      <p className="text-sm">
        <a href={`/api/programmes/${programmeId}/consolidation`} className="text-blue-700 hover:underline">
          Download as a printable PDF →
        </a>{' '}
        <span className="text-xs text-gray-600">
          (add <code>?semester=3</code> or <code>?batch=2024–2027</code> to narrow it)
        </span>
      </p>
    </div>
  );
}
