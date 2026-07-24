import type { Action } from './authz/actions';

export type AuthFailureReason =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_INACTIVE'
  | 'WRONG_PROVIDER'
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'PASSWORD_POLICY';

/** Authentication failure — who you are could not be established. */
export class AuthError extends Error {
  readonly reason: AuthFailureReason;

  constructor(reason: AuthFailureReason, message: string) {
    super(message);
    this.name = 'AuthError';
    this.reason = reason;
  }
}

export type DenialReason =
  | 'ACCOUNT_INACTIVE'
  | 'NO_EFFECTIVE_ROLE'
  | 'OUT_OF_SCOPE'
  | 'COURSE_LOCKED'
  | 'WRONG_STATUS'
  | 'RESOURCE_NOT_FOUND'
  | 'NOT_PERMITTED';

/**
 * Authorisation denial — identity is established, permission is not.
 * A guessed or nonexistent resource id denies with RESOURCE_NOT_FOUND:
 * the guard never reveals whether the id exists, and absence is never
 * an implicit allow.
 */
export class AuthzDeniedError extends Error {
  readonly reason: DenialReason;
  readonly action: Action;
  readonly userId: string;

  constructor(userId: string, action: Action, reason: DenialReason) {
    super(`Denied: ${action.type} for user ${userId} (${reason})`);
    this.name = 'AuthzDeniedError';
    this.reason = reason;
    this.action = action;
    this.userId = userId;
  }
}
