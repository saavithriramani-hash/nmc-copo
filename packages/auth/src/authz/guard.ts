import type { AuditSink } from '../audit';
import { AuthzDeniedError, type DenialReason } from '../errors';
import type { Action } from './actions';
import type { ContextSource, ResourceContext } from './context';
import { decide, type Decision } from './policy';

/**
 * THE server-side enforcement point. Every route handler and server
 * action calls `guard.require(userId, action)` before touching data;
 * nothing else in the system decides permissions. Page components render
 * what the server already authorised — they never carry checks.
 *
 * Properties the tests pin down:
 * - Deny by default: unknown actors, unknown resources ("guessed ids"),
 *   expired roles and out-of-scope roles all deny. A nonexistent id is
 *   indistinguishable from a forbidden one (RESOURCE_NOT_FOUND denial,
 *   no existence oracle).
 * - Time-aware: pass `at` to evaluate against the roles effective at a
 *   past instant — who could lock a course when its snapshot was taken.
 * - Every denial is audit-logged (NFR-9); allows are not logged here
 *   (the data mutations they lead to are logged by their services).
 */
export class Guard {
  constructor(
    private readonly source: ContextSource,
    private readonly audit?: AuditSink,
  ) {}

  /** Decision without throwing — for UI affordances ("can this user lock?"). */
  async check(userId: string, action: Action, at: Date = new Date()): Promise<Decision> {
    const actor = await this.source.getActor(userId, at);
    if (!actor) return { allow: false, reason: 'NO_EFFECTIVE_ROLE' };

    const resource = await this.resolveResource(action);
    if (this.needsResource(action) && resource === null) {
      return { allow: false, reason: 'RESOURCE_NOT_FOUND' };
    }
    return decide(actor, action, resource);
  }

  /** Enforcement: throws AuthzDeniedError (and audit-logs it) unless allowed. */
  async require(userId: string, action: Action, at: Date = new Date()): Promise<void> {
    const decision = await this.check(userId, action, at);
    if (decision.allow) return;
    await this.recordDenial(userId, action, decision.reason);
    throw new AuthzDeniedError(userId, action, decision.reason);
  }

  private needsResource(action: Action): boolean {
    return 'courseId' in action || 'programmeId' in action || 'departmentId' in action;
  }

  private async resolveResource(action: Action): Promise<ResourceContext | null> {
    if ('courseId' in action) return this.source.getCourse(action.courseId);
    if ('programmeId' in action) return this.source.getProgramme(action.programmeId);
    if ('departmentId' in action) return this.source.getDepartment(action.departmentId);
    return null;
  }

  private async recordDenial(userId: string, action: Action, reason: DenialReason): Promise<void> {
    if (!this.audit) return;
    const entityId =
      'courseId' in action ? action.courseId
      : 'programmeId' in action ? action.programmeId
      : 'departmentId' in action ? action.departmentId
      : 'institution';
    await this.audit.record({
      action: 'AUTHZ_DENIED',
      actorId: userId,
      entityType: 'Authorization',
      entityId,
      after: { attempted: action.type, reason },
    });
  }
}
