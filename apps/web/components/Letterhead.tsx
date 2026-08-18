'use client';

import { useState } from 'react';

/**
 * The college letterhead, for the sign-in page.
 *
 * The image is an OPTIONAL asset — the college's own artwork, the crest
 * and the NAAC seal. A fresh checkout, a CI run and a container build
 * must all produce a working application without it, so its absence is a
 * supported state rather than a fault. Drop the banner at
 * `apps/web/public/nmc-letterhead.png` and it appears; leave it out and
 * the same words are set in type instead. See `public/README.md`.
 *
 * That is why this is a client component for what looks like a static
 * image: `onError` is the only way to tell that the file is absent
 * without the reader first seeing a broken-image icon on the one page
 * every user of the system meets.
 */
export function Letterhead() {
  const [failed, setFailed] = useState(false);

  if (failed) return <LetterheadInType />;

  return (
    // A plain <img>, not next/image: this is one fixed asset on one page,
    // served from the same container, and next/image would want its
    // intrinsic dimensions — which cannot be known for a file that is
    // allowed to be missing.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/nmc-letterhead.png"
      alt="Nehru Memorial College (Autonomous), Puthanampatti — nationally reaccredited with A+ grade by NAAC"
      className="w-full max-w-xl h-auto"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The letterhead's own words, when the artwork is not installed.
 *
 * Deliberately the same information in the same order, so the page reads
 * as the college's either way — an application used for accreditation
 * should not look unbranded because a file is missing.
 */
function LetterheadInType() {
  return (
    <div className="text-center max-w-xl">
      <p className="text-xl font-semibold text-blue-900 leading-tight">
        Nehru Memorial College
        <span className="block text-base font-medium">(Autonomous)</span>
      </p>
      <p className="text-xs text-gray-600 mt-1">Nationally Reaccredited with A+ grade by NAAC</p>
      <p className="text-xs text-gray-600">Puthanampatti – 621 007, Tiruchirappalli, Tamilnadu, India.</p>
    </div>
  );
}
