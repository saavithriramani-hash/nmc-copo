import type { DenialReason } from '../errors';
import type { Action } from './actions';
import type { ActorContext, CourseResource, ResourceContext } from './context';

/**
 * THE authorisation policy — the §2 role table as one pure, exhaustive
 * function. Deny by default: an action is allowed only where a rule below
 * explicitly says so. No other permission logic exists anywhere in the
 * system; route handlers call Guard.require, which calls this.
 *
 * Scope decisions applied here (confirmed 24 Jul 2026; see README):
 * - Raw per-student marks follow NFR-10 strictly: course faculty and
 *   their department chain (HoD) ONLY. The §2 "read-all" roles cover
 *   course setup, computed results and consolidations — not raw marks.
 *   Principal sees dashboards/consolidations, not courses or marks.
 * - The system administrator manages accounts and structure, and holds
 *   NO access to academic data (separation of duties).
 * - Faculty edits require DRAFT status; a submitted course is frozen for
 *   faculty while the HoD reviews (HoD may still edit until locked).
 *   A LOCKED course is editable by no one — unlock first (new version).
 *
 * §2 revision (confirmed 30 Jul 2026):
 * - There is no programme coordinator. The HoD is responsible for every
 *   programme of their department, and so holds the PO/PSO definitions,
 *   the articulation matrices and the programme-level parameter
 *   overrides alongside the course-level ones.
 * - IQAC is READ-ONLY: read-all, consolidation, accreditation bundles and
 *   the audit log, but no setting of institution parameters.
 * - DEAN holds what IQAC formerly held, including the institution
 *   attainment parameters (§4.2–§4.4). It is the only role that may write
 *   them; the Principal reads, and the administrator cannot reach them.
 */

export type Decision = { allow: true; via: string } | { allow: false; reason: DenialReason };

const allow = (via: string): Decision => ({ allow: true, via });
const deny = (reason: DenialReason): Decision => ({ allow: false, reason });

// ── role predicates ──────────────────────────────────────────────────────

const has = (actor: ActorContext, kind: string): boolean => actor.roles.some((r) => r.kind === kind);

const isHodOf = (actor: ActorContext, departmentId: string): boolean =>
  actor.roles.some((r) => r.kind === 'HOD' && r.departmentId === departmentId);

const instructs = (actor: ActorContext, course: CourseResource): boolean =>
  has(actor, 'FACULTY') && course.instructorIds.includes(actor.userId);

// ── the policy ───────────────────────────────────────────────────────────

export function decide(actor: ActorContext, action: Action, resource: ResourceContext | null): Decision {
  if (!actor.isActive) return deny('ACCOUNT_INACTIVE');
  if (actor.roles.length === 0) return deny('NO_EFFECTIVE_ROLE');

  switch (action.type) {
    // ── course-scoped ────────────────────────────────────────────────
    case 'course.read':
    case 'course.write':
    case 'course.staff':
    case 'matrix.write':
    case 'marks.read':
    case 'marks.write':
    case 'course.submit':
    case 'course.lock':
    case 'course.unlock':
    case 'settings.course.write': {
      if (resource?.kind !== 'course') return deny('RESOURCE_NOT_FOUND');
      return decideCourse(actor, action.type, resource);
    }

    // ── programme-scoped ─────────────────────────────────────────────
    case 'programme.read': {
      if (resource?.kind !== 'programme') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      if (has(actor, 'DEAN')) return allow('DEAN');
      if (has(actor, 'IQAC')) return allow('IQAC');
      if (has(actor, 'PRINCIPAL')) return allow('PRINCIPAL');
      return deny('OUT_OF_SCOPE');
    }
    case 'programme.manage':
    case 'settings.programme.write': {
      // PO/PSO definitions (FR-2) and programme-level parameter overrides
      // belong to the HoD of the programme's department: a programme is
      // owned by exactly one department, and there is no coordinator.
      if (resource?.kind !== 'programme') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }

    // ── department-scoped ────────────────────────────────────────────
    case 'department.read': {
      if (resource?.kind !== 'department') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      if (has(actor, 'DEAN')) return allow('DEAN');
      if (has(actor, 'IQAC')) return allow('IQAC');
      if (has(actor, 'PRINCIPAL')) return allow('PRINCIPAL');
      return deny('OUT_OF_SCOPE');
    }
    case 'course.create':
    case 'templates.manage':
    case 'roster.manage': {
      // Courses are created, assessment templates defined, and batch
      // rosters imported by the department chain (§2 HoD: all faculty
      // capability department-wide; FR-8/FR-10).
      if (resource?.kind !== 'department') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }
    case 'batches.manage': {
      // CR-2: a batch is an incoming cohort of one programme, so it is
      // department-scoped even though it is structure. The HoD knows when
      // a cohort arrives and already owns its roster (FR-10), and had to
      // ask the administrator for the container first.
      //
      // Unlike the three actions above, the administrator KEEPS this:
      // batches were theirs alone before CR-2, they create them during
      // rollover, and a department between HoDs must not be stranded.
      if (resource?.kind !== 'department') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      if (has(actor, 'ADMIN')) return allow('ADMIN');
      return deny('OUT_OF_SCOPE');
    }

    // ── institution-wide ─────────────────────────────────────────────
    case 'institution.read': {
      if (has(actor, 'DEAN')) return allow('DEAN');
      if (has(actor, 'IQAC')) return allow('IQAC');
      if (has(actor, 'PRINCIPAL')) return allow('PRINCIPAL');
      return deny('NOT_PERMITTED');
    }
    case 'settings.institution.write': {
      // The Dean alone. These parameters change every attainment figure
      // not already locked into a snapshot, across every department;
      // IQAC reports on them but does not set them.
      return has(actor, 'DEAN') ? allow('DEAN') : deny('NOT_PERMITTED');
    }
    case 'users.manage':
    case 'departments.manage':
    case 'rollover.execute':
    case 'backups.manage': {
      return has(actor, 'ADMIN') ? allow('ADMIN') : deny('NOT_PERMITTED');
    }
    case 'audit.read': {
      if (has(actor, 'ADMIN')) return allow('ADMIN');
      if (has(actor, 'DEAN')) return allow('DEAN');
      if (has(actor, 'IQAC')) return allow('IQAC');
      return deny('NOT_PERMITTED');
    }
  }
}

function decideCourse(
  actor: ActorContext,
  type: Extract<Action, { courseId: string }>['type'],
  course: CourseResource,
): Decision {
  const own = instructs(actor, course);
  const hod = isHodOf(actor, course.departmentId);

  switch (type) {
    case 'course.read': {
      // Setup and computed results — NOT raw marks.
      if (own) return allow('FACULTY(own course)');
      if (hod) return allow('HOD');
      if (has(actor, 'DEAN')) return allow('DEAN'); // §2 read-all
      if (has(actor, 'IQAC')) return allow('IQAC'); // §2 read-all
      return deny('OUT_OF_SCOPE');
    }

    case 'marks.read': {
      // NFR-10: per-student marks are visible only to the course faculty
      // and their department chain. Not IQAC, not Principal, not admin.
      if (own) return allow('FACULTY(own course)');
      if (hod) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }

    case 'course.write':
    case 'marks.write': {
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      // Faculty edit their own DRAFT course; once submitted it is frozen
      // for them while the HoD reviews. The HoD (department-wide faculty
      // capability, §2) may edit until the course is locked.
      if (own && course.status === 'DRAFT') return allow('FACULTY(own course)');
      if (own) return deny('WRONG_STATUS');
      if (hod) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }

    case 'course.staff': {
      // WHO TEACHES the course is a departmental decision, not the
      // course's own. FR-4 makes assigned faculty part of creating a
      // course, and course.create is HoD-only; §2 gives Faculty course
      // setup, mark entry, compute, export and submit — not staffing.
      //
      // Deliberately NOT course.write: an instructor who could edit the
      // instructor list could grant any faculty member in the college
      // read/write access to this course's per-student marks, defeating
      // NFR-10 (marks are for the course faculty and their department
      // chain only). They could also remove a colleague the HoD posted,
      // or strand the course by removing themselves.
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      return hod ? allow('HOD') : deny('OUT_OF_SCOPE');
    }

    case 'matrix.write': {
      // The articulation matrix is a programme-level concern held by the
      // course's own chain: the faculty on a DRAFT, the HoD until locked.
      // Never on a locked course.
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      if (own && course.status === 'DRAFT') return allow('FACULTY(own course)');
      if (own) return deny('WRONG_STATUS');
      if (hod) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }

    case 'course.submit': {
      if (course.status !== 'DRAFT') return deny('WRONG_STATUS');
      if (own) return allow('FACULTY(own course)');
      if (hod) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }

    case 'course.lock': {
      // FR-16: faculty submits → HoD reviews and locks.
      if (course.status !== 'SUBMITTED') return deny('WRONG_STATUS');
      return hod ? allow('HOD') : deny('OUT_OF_SCOPE');
    }

    case 'course.unlock': {
      // Unlocking creates a new version; it never rewrites the snapshot.
      if (course.status !== 'LOCKED') return deny('WRONG_STATUS');
      return hod ? allow('HOD') : deny('OUT_OF_SCOPE');
    }

    case 'settings.course.write': {
      // Course-level parameter override records an Academic-Council-
      // minuted exception; entered by the department chain, not the
      // course faculty, and never on a locked course.
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      return hod ? allow('HOD') : deny('OUT_OF_SCOPE');
    }
  }
}
