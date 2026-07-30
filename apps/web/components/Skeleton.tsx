/**
 * Loading placeholders.
 *
 * Server components, deliberately: they are rendered by `loading.tsx`
 * files, which Next streams *before* the page's own data resolves. No
 * state, no effects — just the shape of what is coming.
 *
 * The shapes mirror the real layouts closely enough that nothing jumps
 * when the content arrives. Where a wait has a *reason* the user should
 * know about (attainment is computed on demand from every mark in the
 * course, never read from a stored figure), say so rather than showing a
 * bare spinner: the delay is the system doing the work it promises.
 */

export function SkeletonLine({ className = 'w-48' }: { className?: string }) {
  return <span className={`inline-block h-4 rounded bg-gray-200 animate-pulse ${className}`} />;
}

/** A heading plus a short subtitle, matching a section header block. */
export function SkeletonHeading({ width = 'w-40' }: { width?: string }) {
  return (
    <div className="space-y-2">
      <div className={`h-5 rounded bg-gray-200 animate-pulse ${width}`} />
      <div className="h-3 w-64 rounded bg-gray-100 animate-pulse" />
    </div>
  );
}

/**
 * A table outline: real header cells (so column widths settle now, not
 * on arrival) over pulsing body rows.
 */
export function SkeletonTable({ columns, rows = 5 }: { columns: string[]; rows?: number }) {
  return (
    <table className="bg-white border-collapse">
      <thead>
        <tr className="bg-gray-100 text-left">
          {columns.map((column) => (
            <th key={column} className="border border-gray-300 px-2 py-1">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row}>
            {columns.map((column) => (
              <td key={column} className="border border-gray-300 px-2 py-1">
                <SkeletonLine className="w-16" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Why the page is busy. `aria-live="polite"` so a screen reader
 * announces the wait instead of leaving the user on a silent page.
 */
export function LoadingNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-gray-600 flex items-center gap-2" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-blue-700 animate-spin"
      />
      {children}
    </p>
  );
}
