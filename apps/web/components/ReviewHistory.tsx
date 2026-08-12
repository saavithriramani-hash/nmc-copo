import type { ReviewRound } from '@/lib/dashboard';

/**
 * How this course came to be approved (FR-16): every round of submission
 * and what the HoD decided, newest first.
 *
 * This is not the audit log — that records every edit and is the
 * administrator's. This is the academic record of the review, and it
 * belongs beside the figures it approved, because an assessor asking
 * "who accepted this, and had anything been queried?" is asking about
 * this course, not about the system.
 *
 * Nothing here can be edited. A returned round keeps its comment for
 * good, including after the faculty member fixes what it asked for.
 */
export function ReviewHistory({ rounds }: { rounds: ReviewRound[] }) {
  if (rounds.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="font-medium text-sm">Review history</h3>
      <ol className="space-y-2">
        {rounds.map((round) => (
          <li key={round.id} className="border border-gray-300 rounded bg-white p-3 text-sm space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Outcome resolution={round.resolution} version={round.approvedVersion} />
              <span className="text-gray-700">
                submitted by {round.submittedBy} on {round.submittedAt.toLocaleDateString()}
              </span>
              {round.resolvedBy ? (
                <span className="text-gray-700">
                  · {round.resolution === 'APPROVED' ? 'approved' : 'returned'} by {round.resolvedBy} on{' '}
                  {round.resolvedAt?.toLocaleDateString()}
                </span>
              ) : null}
            </div>
            {round.returnComment ? (
              <blockquote className="text-amber-900 border-l-2 border-amber-400 pl-3 whitespace-pre-wrap">
                {round.returnComment}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Outcome({ resolution, version }: { resolution: ReviewRound['resolution']; version: number | null }) {
  if (resolution === 'APPROVED') {
    return (
      <span className="text-xs bg-green-100 text-green-900 border border-green-300 rounded px-2 py-0.5 whitespace-nowrap">
        Approved{version ? ` · v${version}` : ''}
      </span>
    );
  }
  if (resolution === 'RETURNED') {
    return (
      <span className="text-xs bg-amber-100 text-amber-900 border border-amber-300 rounded px-2 py-0.5 whitespace-nowrap">
        Sent back
      </span>
    );
  }
  return (
    <span className="text-xs bg-blue-100 text-blue-900 border border-blue-300 rounded px-2 py-0.5 whitespace-nowrap">
      Awaiting approval
    </span>
  );
}
