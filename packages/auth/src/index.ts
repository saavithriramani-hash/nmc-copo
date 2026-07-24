/**
 * @copo/auth — authentication and authorisation.
 *
 * Authentication: local accounts behind the AuthProvider interface;
 * adding the Google Workspace OIDC provider later touches nothing
 * outside this package (accounts are matched by email and re-pointed;
 * the internal user id never changes).
 *
 * Authorisation: one pure policy (authz/policy.ts) enforced by one
 * server-side Guard. No permission checks live anywhere else.
 */

// Authentication
export type { AuthProvider, Credentials, AuthOutcome } from './provider';
export { LocalAuthProvider, normaliseEmail } from './localProvider';
export { AuthService } from './auth';
export { relinkIdentityByEmail } from './identity';
export {
  hashPassword,
  verifyPassword,
  needsRehash,
  generateTemporaryPassword,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
} from './password';

// Sessions
export {
  SessionService,
  evaluateSession,
  hashSessionToken,
  DEFAULT_SESSION_CONFIG,
  type SessionConfig,
  type LiveSession,
} from './sessions';

// Accounts and roles
export { AccountService } from './accounts';
export { RoleService, type RoleKindValue } from './roles';

// Authorisation
export type { Action, CourseActionType, ProgrammeActionType, DepartmentActionType, InstitutionActionType } from './authz/actions';
export { COURSE_ACTION_TYPES } from './authz/actions';
export { decide, type Decision } from './authz/policy';
export { Guard } from './authz/guard';
export {
  PrismaContextSource,
  roleEffectiveAt,
  type ContextSource,
  type ActorContext,
  type EffectiveRole,
  type ResourceContext,
  type CourseResource,
  type ProgrammeResource,
  type DepartmentResource,
} from './authz/context';

// Audit
export { PrismaAuditSink, MemoryAuditSink, type AuditSink, type AuthAuditEvent, type AuthAuditAction } from './audit';

// Errors
export { AuthError, AuthzDeniedError, type AuthFailureReason, type DenialReason } from './errors';
