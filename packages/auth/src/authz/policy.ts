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
    case 'course.details.write':
    case 'assessment.external.write':
    case 'marks.external.write':
    case 'course.staff':
    case 'matrix.write':
    case 'marks.read':
    case 'marks.write':
    case 'learners.rate':
    case 'course.submit':
    case 'course.lock':
    case 'course.return':
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
    case 'learners.read': {
      // CR-8: the roll that NAMES students as slow learners. NFR-10 in
      // spirit rather than by letter — these are not marks, but a list
      // labelling identifiable students by learning ability is at least
      // as sensitive as one, so it stops at the department chain. The
      // Dean, IQAC and Principal keep the counts and the distribution
      // under programme.read, which carries no names.
      if (resource?.kind !== 'programme') return deny('RESOURCE_NOT_FOUND');
      return isHodOf(actor, resource.departmentId) ? allow('HOD') : deny('OUT_OF_SCOPE');
    }
    case 'learners.configure':
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
    case 'templates.manage': {
      // Department assessment templates (FR-8): a pattern the HoD
      // captured from one of their own courses. The COE publishes
      // institution-wide templates for the external examination, which
      // is the same action with no department attached.
      if (resource?.kind !== 'department') return deny('RESOURCE_NOT_FOUND');
      if (isHodOf(actor, resource.departmentId)) return allow('HOD');
      if (has(actor, 'COE')) return allow('COE');
      return deny('OUT_OF_SCOPE');
    }
    case 'course.create':
    case 'batches.manage':
    case 'roster.manage': {
      // CR-3: the examinations office owns the catalogue and the
      // register. Creating a course, the batches a cohort arrives in,
      // and the roster of students in them are all theirs, across every
      // department.
      //
      // This SUPERSEDES CR-2, which had given batches to the HoD on the
      // reasoning that they owned the roster going into one. Both have
      // now moved together, so that reasoning still holds — it just
      // points at the COE instead.
      //
      // The HoD keeps everything about running a course: staffing it,
      // its outcomes, its internal marks, approval and locking.
      if (resource?.kind !== 'department') return deny('RESOURCE_NOT_FOUND');
      return has(actor, 'COE') ? allow('COE') : deny('NOT_PERMITTED');
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
    case 'templates.institution.manage': {
      // CR-3: an assessment template with no department is the external
      // examination pattern the whole college adopts, so it is the
      // examinations office's alone. Department templates (FR-8) stay
      // with the HoD under `templates.manage`, which carries a scope.
      return has(actor, 'COE') ? allow('COE') : deny('NOT_PERMITTED');
    }
    case 'departments.manage': {
      // CR-5: the examinations office holds the academic structure —
      // departments and programmes, as it already holds the batches
      // inside them, the courses, and the rosters. Added, not moved: the
      // administrator keeps it, because rollover creates structures and
      // a college between Controllers must not be stranded.
      if (has(actor, 'ADMIN')) return allow('ADMIN');
      return has(actor, 'COE') ? allow('COE') : deny('NOT_PERMITTED');
    }
    case 'users.manage':
    case 'institution.create':
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
      // CR-3: the COE owns the catalogue and the external examination, so
      // they must be able to find and open any course in the college.
      if (has(actor, 'COE')) return allow('COE');
      return deny('OUT_OF_SCOPE');
    }

    case 'marks.read': {
      // NFR-10 as amended by CR-3: per-student marks are visible to the
      // course faculty and their department chain — and to the COE, who
      // enters the end-semester marks and cannot do so blind. Still not
      // IQAC, not the Principal, not the administrator.
      //
      // The COE's reach is bounded at the point of use rather than here:
      // the mark screens serve one assessment at a time and demand
      // marks.external.write to open a COE-owned one, so a theory
      // course's internal tests never appear to them.
      if (own) return allow('FACULTY(own course)');
      if (hod) return allow('HOD');
      if (has(actor, 'COE')) return allow('COE');
      return deny('OUT_OF_SCOPE');
    }

    case 'learners.rate': {
      // CR-8: the slow/advanced learner ratings.
      //
      // STATUS DOES NOT GATE THIS, and that is deliberate — it is the one
      // course-scoped write in the system that a LOCKED course still
      // allows. The lock exists to freeze attainment: it seals an
      // immutable snapshot of the ten steps so an auditor can replay it.
      // These ratings enter no snapshot, feed no CO or PO figure, and are
      // read only by the standalone NAAC 2.2.1 report, so nothing a lock
      // protects can move when one is written. Gating them would instead
      // strand the department: attainment is locked at the end of the
      // semester and the 2.2.1 return is prepared on its own calendar,
      // months later, against courses long since locked.
      //
      // The people are the same as for marks, minus the COE: this is the
      // teacher's own judgement of a student they taught.
      if (own) return allow('FACULTY(own course)');
      if (hod) return allow('HOD');
      return deny('OUT_OF_SCOPE');
    }

    case 'course.details.write': {
      // CR-3: the course catalogue is the examinations office's record —
      // code, title, semester, credits and the Laboratory flag. Faculty
      // and the HoD read them; nobody else writes them. Deliberately not
      // folded into course.write, which is the whole of course SETUP and
      // belongs to the people teaching it.
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      return has(actor, 'COE') ? allow('COE') : deny('NOT_PERMITTED');
    }

    case 'assessment.external.write':
    case 'marks.external.write': {
      // The end-semester examination. On a THEORY paper it is set and
      // marked by the examinations office; on a LABORATORY paper the
      // department conducts the practical examination itself, so it
      // falls back to the course's own chain exactly like any other
      // assessment.
      if (course.status === 'LOCKED') return deny('COURSE_LOCKED');
      if (course.isLaboratory) {
        if (own && course.status === 'DRAFT') return allow('FACULTY(own laboratory course)');
        if (own) return deny('WRONG_STATUS');
        return hod ? allow('HOD(laboratory course)') : deny('OUT_OF_SCOPE');
      }
      return has(actor, 'COE') ? allow('COE') : deny('NOT_PERMITTED');
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

    case 'course.return': {
      // The other half of reviewing, which the workflow lacked: sending
      // a submission back with the reason it was not approved. Same
      // authority and same moment as locking — the HoD, on a SUBMITTED
      // course — because they are the two outcomes of one decision.
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
