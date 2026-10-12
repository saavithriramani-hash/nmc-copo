'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { offerCourseToBatchAction, type OfferCourseResult } from '@/actions/course';
import { useServerAction } from './useServerAction';

/**
 * CR-10: offer this course to another batch of its programme — the next
 * year's intake. The batches that already hold a course with this code
 * are listed but disabled, with the reason; the server checks again.
 */
export function OfferToBatchForm({
  courseId,
  code,
  batches,
}: {
  courseId: string;
  code: string;
  batches: { id: string; name: string; hasCode: boolean }[];
}) {
  const action = offerCourseToBatchAction.bind(null, courseId);
  const { result, pending, onSubmit } = useServerAction<OfferCourseResult>(action);
  const available = batches.filter((batch) => !batch.hasCode);
  const router = useRouter();

  // Straight on to the new course; the link below stays in case the
  // navigation is slow to start.
  const newCourseId = result?.newCourseId;
  useEffect(() => {
    if (newCourseId) router.push(`/courses/${newCourseId}`);
  }, [newCourseId, router]);

  if (batches.length === 0) {
    return <p className="text-xs text-gray-500">This programme has no other batch yet.</p>;
  }

  return (
    <div className="space-y-1">
      <form onSubmit={onSubmit} className="flex gap-2 items-center flex-wrap">
        <select
          name="batchId"
          required
          defaultValue=""
          className="border border-gray-300 rounded px-2 py-1.5 bg-white"
          aria-label="Batch to offer this course to"
        >
          <option value="" disabled>
            Choose a batch…
          </option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id} disabled={batch.hasCode}>
              {batch.name}
              {batch.hasCode ? ` — already has ${code}` : ''}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || available.length === 0}
          className="bg-blue-700 text-white rounded px-3 py-1.5 hover:bg-blue-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Offer to batch'}
        </button>
      </form>
      {result?.error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{result.error}</p>
      ) : null}
      {result?.newCourseId ? (
        <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">
          Created.{' '}
          <Link href={`/courses/${result.newCourseId}`} className="text-blue-700 hover:underline">
            Open the new course
          </Link>{' '}
          — its Head of Department assigns the faculty.
        </p>
      ) : null}
    </div>
  );
}
