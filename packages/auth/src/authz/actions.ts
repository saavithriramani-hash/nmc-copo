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
  | 'course.details.write' // CR-3: code, title, semester, credits, Laboratory flag — the COE alone
  | 'course.staff' // who teaches the course (FR-4 staffing — HoD, never the faculty themselves)
  | 'matrix.write' // CO↔PO articulation matrix (§2: coordinator capability too)
  | 'marks.read' // per-student raw marks (NFR-10: faculty + department chain only)
  | 'marks.write' // mark entry / import
  // ── CR-3: the external examination ────────────────────────────────────
  // Split from course.write and marks.write because the Controller of
  // Examinations owns the end-semester paper and nothing else on the
  // course. On a LABORATORY course the department conducts its own
  // practical examination, so both fall back to the course's own chain.
  | 'assessment.external.write' // create/edit an assessment in the external weight group
  | 'marks.external.write' // enter marks for one
  // CR-8: the slow/advanced learner ratings for this course. Its own
  // action rather than course.write, because it is a per-student judgement
  // of a named individual — nearer to marks than to course setup — and
  // because it stays open on a SUBMITTED course, which course.write does
  // not: the NAAC 2.2.1 return is filed on its own calendar and must not
  // be blocked by an attainment submission awaiting approval.
  | 'learners.rate'
  | 'course.submit' // faculty → HoD (FR-16)
  | 'course.lock' // HoD approves and locks → immutable snapshot
  | 'course.return' // HoD sends a submission back, with the reason (FR-16)
  | 'course.unlock' // HoD; creates a new version, never rewrites
  | 'settings.course.write'; // course-level parameter override (minuted exception)

/** Actions on one programme. */
export type ProgrammeActionType =
  | 'programme.read' // programme attainment / consolidation
  | 'programme.manage' // PO/PSO definitions (FR-2)
  | 'settings.programme.write' // programme-level parameter override
  // CR-8: the consolidated slow/advanced learner roll, which NAMES the
  // students classified as slow. Split from programme.read, which the
  // Dean, IQAC and Principal hold: a roll of named individuals follows
  // NFR-10 and stops at the department chain. The counts and the
  // distribution carry no names and stay under programme.read.
  | 'learners.read' // the named roll
  | 'learners.configure'; // the criteria and the category bands

/** Actions on one department. */
export type DepartmentActionType =
  | 'department.read' // department consolidation
  | 'course.create' // create a course in a batch of this department (FR-4)
  | 'templates.manage' // department assessment templates (FR-8)
  | 'roster.manage' // import/edit batch rosters of this department (FR-10)
  | 'batches.manage'; // create batches in this department's programmes (CR-2) — shared with the administrator

/** Institution-wide actions (no resource id). */
export type InstitutionActionType =
  | 'institution.read' // consolidations, dashboards, accreditation bundles
  | 'settings.institution.write' // global attainment defaults (IQAC)
  | 'templates.institution.manage' // CR-3: institution-wide external exam patterns (COE)
  | 'users.manage' // accounts + role assignments (admin)
  // CR-5 splits what used to be one action. Creating the institution
  // record seeds the institution attainment parameters (§4.2–§4.4), and
  // CR-1 made the Dean the only role that sets those — so it cannot ride
  // along with the department and programme tree.
  | 'institution.create' // the one-shot institution record, at deployment (admin)
  | 'departments.manage' // departments and programmes (batches are `batches.manage`)
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
  'course.details.write',
  'assessment.external.write',
  'marks.external.write',
  'course.staff',
  'matrix.write',
  'marks.read',
  'marks.write',
  'learners.rate',
  'course.submit',
  'course.return',
  'course.lock',
  'course.unlock',
  'settings.course.write',
];
