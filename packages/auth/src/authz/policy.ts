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
 *   their department chain (HoD) ONLY. IQAC's §2 "read-all" covers
 *   course setup, computed results and consolidations — not raw marks.
 *   Principal sees dashboards/consolidations, not courses or marks.
 * - The system administrator manages accounts and structure, and holds
 *   NO access to academic data (separation of duties).
 * - Faculty edits require DRAFT status; a submitted course is frozen for
 *   faculty while the HoD reviews (HoD may still edit until locked).
 *   A LOCKED course is editable by no one — unlock first (new version).
 * - Programme-level parameter overrides belong to the programme
 *   coordinator; course-level overrides (minuted exceptions) to the HoD.
 */

export type Decision = { allow: true; via: string } | { allow: false; reason: DenialReason };

const allow = (via: string): Decision => ({ allow: true, via });
const deny = (reason: DenialReason): Decision => ({ allow: false, reason });

// ── role predicates ──────────────────────────────────────────────────────

const has = (actor: ActorContext, kind: string): boolean => actor.roles.some((r) => r.kind === kind);

const isHodOf = (actor: ActorContext, departmentId: string): boolean =>
  actor.roles.some((r) => r.kind === 'HOD' && r.departmentId === departmentId);

const isCoordinatorOf = (actor: ActorContext, programmeId: string): boolean =>
  actor.roles.some((r) => r.kind === 'PROGRAMME_COORDINATOR' && r.programmeId === programmeId);

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
      if (isCoordinatorOf(actor, resource.programmeId)) return allow('PROGRAMME_COORDINATOR');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      if (has(actor, 'IQAC')) return allow('IQAC');
      if (has(actor, 'PRINCIPAL')) return allow('PRINCIPAL');
      return deny('OUT_OF_SCOPE');
    }
    case 'programme.manage':
    case 'settings.programme.write': {
      if (resource?.kind !== 'programme') return deny('RESOURCE_NOT_FOUND');
      if (isCoordinatorOf(actor, resource.programmeId)) return allow('PROGRAMME_COORDINATOR');
      return deny('OUT_OF_SCOPE');
    }

    // ── department-scoped ────────────────────────────────────────────
    case 'department.read': {
      if (resource?.kind !== 'department') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
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

    // ── institution-wide ─────────────────────────────────────────────
    case 'institution.read': {
      if (has(actor, 'IQAC')) return allow('IQAC');
      if (has(actor, 'PRINCIPAL')) return allow('PRINCIPAL');
      return deny('NOT_PERMITTED');
    }
    case 'settings.institution.write': {
      return has(actor, 'IQAC') ? allow('IQAC') : deny('NOT_PERMITTED');
    }
    case 'users.manage':
    case 'departments.manage':
    case 'rollover.execute':
    case 'backups.manage': {
      return has(actor, 'ADMIN') ? allow('ADMIN') : deny('NOT_PERMITTED');
    }
    case 'audit.read': {
      if (has(actor, 'ADMIN')) return allow('ADMIN');
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
  const coordinator = isCoordinatorOf(actor, course.programmeId);

  switch (type) {
    case 'course.read': {
      // Setup and computed results — NOT raw marks.
      if (own) return allow('FACULTY(own course)');
      if (hod) return allow('HOD');
      if (coordinator) return allow('PROGRAMME_COORDINATOR');
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

    case 'matrix.write': {
      // §2 grants articulation matrices to the programme coordinator as
      // well as the course's own chain. Never on a locked course.
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      if (own && course.status === 'DRAFT') return allow('FACULTY(own course)');
      if (own) return deny('WRONG_STATUS');
      if (hod) return allow('HOD');
      if (coordinator) return allow('PROGRAMME_COORDINATOR');
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
