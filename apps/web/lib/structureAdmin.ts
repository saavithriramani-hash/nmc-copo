/**
 * Rename and delete rules for the structural spine: department →
 * programme → batch (FR-1). Pure, so every rule is unit-testable without
 * a database.
 *
 * DELETION POLICY (confirmed): a structure row may be deleted only while
 * nothing references it. If anything does, the action refuses and names
 * what blocks it — the same shape as the existing CO, PO/PSO, assessment
 * and enrolment deletions. This is never a cascade: no course, mark,
 * roster entry, role assignment or locked snapshot is ever removed as a
 * side effect of deleting a structure row.
 *
 * The database enforces the same rule independently (`onDelete: Restrict`
 * on every relation into Department, Programme and Batch), so a race
 * between the check and the delete fails safe at the database rather than
 * destroying anything.
 *
 * The one exception is a programme's own PO/PSO definitions, which are
 * owned by the programme rather than referencing it, and are removed with
 * it. That is only reachable when the programme has no batches — hence no
 * courses, hence no articulation matrix could cite them. The confirmation
 * states the count before it happens.
 */

export interface Blocker {
  /** Human-readable, already pluralised: "2 programmes". */
  label: string;
  count: number;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function collect(entries: [number, string, string?][]): Blocker[] {
  const blockers: Blocker[] = [];
  for (const [count, singular, plural] of entries) {
    if (count > 0) blockers.push({ label: pluralise(count, singular, plural), count });
  }
  return blockers;
}

export function departmentBlockers(counts: {
  programmes: number;
  roles: number;
  templates: number;
}): Blocker[] {
  return collect([
    [counts.programmes, 'programme'],
    [counts.roles, 'role assignment'],
    [counts.templates, 'assessment template'],
  ]);
}

/**
 * No role assignment can reference a programme since the §2 revision of
 * 30 Jul 2026 — the HoD is department-scoped and covers every programme —
 * so batches are the only thing that can hold a programme open. The
 * department still checks role assignments, because HoD rows point there.
 */
export function programmeBlockers(counts: { batches: number }): Blocker[] {
  return collect([[counts.batches, 'batch', 'batches']]);
}

export function batchBlockers(counts: { courses: number; roster: number }): Blocker[] {
  return collect([
    [counts.courses, 'course'],
    [counts.roster, 'student on the roster', 'students on the roster'],
  ]);
}

/** "2 programmes and 1 role assignment"; Oxford-free, reads aloud cleanly. */
export function joinBlockers(blockers: Blocker[]): string {
  const labels = blockers.map((b) => b.label);
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The refusal a non-specialist should be able to act on without help. */
export function blockMessage(name: string, blockers: Blocker[]): string {
  return `“${name}” cannot be deleted: ${joinBlockers(blockers)} still ${
    blockers.length === 1 && blockers[0]!.count === 1 ? 'depends' : 'depend'
  } on it. Remove or reassign those first.`;
}

export const MAX_NAME_LENGTH = 200;

/** Shared by rename and create. Null when acceptable. */
export function validateStructureName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'A name is required.';
  if (trimmed.length > MAX_NAME_LENGTH) return `A name may be at most ${MAX_NAME_LENGTH} characters.`;
  return null;
}

/** What the confirmation must disclose before a delete proceeds. */
export function deletionSummary(
  kind: 'department' | 'programme' | 'batch',
  name: string,
  extra: { outcomes?: number } = {},
): string {
  if (kind === 'programme' && (extra.outcomes ?? 0) > 0) {
    return `Delete “${name}” and its ${pluralise(extra.outcomes!, 'PO/PSO definition')}? This cannot be undone.`;
  }
  return `Delete “${name}”? This cannot be undone.`;
}
