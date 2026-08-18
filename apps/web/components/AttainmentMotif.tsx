/**
 * The decorative panel of the sign-in page.
 *
 * An articulation matrix — course outcomes down, programme outcomes
 * across, each cell a correlation of 1, 2 or 3 and many of them blank.
 * It is the first thing the application computes and the shape every
 * later figure descends from, so it says what this system is to somebody
 * who already knows the work.
 *
 * Chosen over a stock illustration deliberately. This is the sign-in page
 * of an accreditation system that a NAAC or NBA peer team may see; a
 * cartoon would be the wrong register, and a photograph would date.
 *
 * Purely decorative — `aria-hidden`, with no text of its own. Everything
 * a reader needs is in the letterhead above it.
 */

/** A real-looking matrix: strong on the diagonal, sparse away from it. */
const STRENGTHS: readonly (readonly number[])[] = [
  [3, 2, 0, 1, 2, 0],
  [2, 3, 1, 0, 0, 2],
  [0, 1, 3, 2, 1, 0],
  [1, 0, 2, 3, 0, 3],
];

const CELL = 34;
const GAP = 10;
const R = 7;

/** blue-700, at the weight the correlation carries. Blank stays an outline. */
function cellFill(strength: number): { fill: string; opacity: number } {
  if (strength === 3) return { fill: '#1d4ed8', opacity: 1 };
  if (strength === 2) return { fill: '#1d4ed8', opacity: 0.55 };
  if (strength === 1) return { fill: '#1d4ed8', opacity: 0.24 };
  return { fill: 'none', opacity: 1 };
}

export function AttainmentMotif({ className = '' }: { className?: string }) {
  const cols = STRENGTHS[0]!.length;
  const rows = STRENGTHS.length;
  const width = cols * CELL + (cols - 1) * GAP;
  const height = rows * CELL + (rows - 1) * GAP;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {STRENGTHS.map((row, y) =>
        row.map((strength, x) => {
          const { fill, opacity } = cellFill(strength);
          return (
            <rect
              key={`${x}-${y}`}
              x={x * (CELL + GAP)}
              y={y * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={R}
              fill={fill}
              fillOpacity={opacity}
              stroke={strength === 0 ? '#cbd5e1' : 'none'}
              strokeWidth={strength === 0 ? 1.5 : 0}
            />
          );
        }),
      )}
    </svg>
  );
}
