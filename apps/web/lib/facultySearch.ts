/**
 * Matching for the faculty picker (FR-4 staffing), pure and testable.
 *
 * Kept out of the component because it decides who a Head of Department
 * can see when assigning a course, and "the name I typed did not come
 * up" is a support call rather than a cosmetic complaint.
 */

export interface FacultyOption {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Filters on name AND email, because staff are looked up both ways — by
 * the name on the timetable, or by the address on a memo.
 *
 * Substring rather than prefix: Tamil names are frequently recorded with
 * an initial first ("R. Meena", "Meena R"), and a prefix match on the
 * stored order would hide the person from anyone who typed the other.
 * Every space-separated term must match somewhere, so "meena phy" finds
 * "Meena Sundaram (meena.s@physics.nmc.edu)" while still narrowing.
 */
export function matchFaculty<T extends FacultyOption>(options: readonly T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...options];
  return options.filter((option) => {
    const haystack = `${option.fullName} ${option.email}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * Removes people already assigned to the course. Offering someone who is
 * already on the list invites a click that appears to do nothing — the
 * server upserts, so it is harmless, but it reads as a broken control.
 */
export function excludeAssigned<T extends FacultyOption>(
  options: readonly T[],
  assignedUserIds: Iterable<string>,
): T[] {
  const assigned = new Set(assignedUserIds);
  return options.filter((option) => !assigned.has(option.id));
}
