/**
 * The complete catalogue of authorisable actions. Every server-side
 * operation names exactly one of these and passes it to Guard.require —
 * permission logic exists nowhere else (no checks in page components,
 * ever). Adding a capability means adding it here and in policy.ts,
 * where the reviewer sees the whole permission surface in one diff.
 */

/** Actions on one course (setup, marks, workflow). */
export type CourseActionType =
  | 'course.read' // setup + computed results + exports
  | 'course.write' // course setup: COs, assessments, indirect feedback
  | 'matrix.write' // CO↔PO articulation matrix (§2: coordinator capability too)
  | 'marks.read' // per-student raw marks (NFR-10: faculty + department chain only)
  | 'marks.write' // mark entry / import
  | 'course.submit' // faculty → HoD (FR-16)
  | 'course.lock' // HoD approves and locks → immutable snapshot
  | 'course.unlock' // HoD; creates a new version, never rewrites
  | 'settings.course.write'; // course-level parameter override (minuted exception)

/** Actions on one programme. */
export type ProgrammeActionType =
  | 'programme.read' // programme attainment / consolidation
  | 'programme.manage' // PO/PSO definitions (FR-2)
  | 'settings.programme.write'; // programme-level parameter override

/** Actions on one department. */
export type DepartmentActionType = 'department.read'; // department consolidation

/** Institution-wide actions (no resource id). */
export type InstitutionActionType =
  | 'institution.read' // consolidations, dashboards, accreditation bundles
  | 'settings.institution.write' // global attainment defaults (IQAC)
  | 'users.manage' // accounts + role assignments (admin)
  | 'departments.manage' // departments, programmes, batches, rollover structures
  | 'rollover.execute' // academic-year rollover
  | 'backups.manage' // backup/restore operations
  | 'audit.read'; // the audit log itself

export type Action =
  | { type: CourseActionType; courseId: string }
  | { type: ProgrammeActionType; programmeId: string }
  | { type: DepartmentActionType; departmentId: string }
  | { type: InstitutionActionType };

export const COURSE_ACTION_TYPES: readonly CourseActionType[] = [
  'course.read',
  'course.write',
  'matrix.write',
  'marks.read',
  'marks.write',
  'course.submit',
  'course.lock',
  'course.unlock',
  'settings.course.write',
];
