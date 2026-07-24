/**
 * THE authentication interface (§2.1). Everything outside packages/auth
 * sees only this: credentials in, a verified internal user id out.
 *
 * Today there is exactly one implementation, LocalAuthProvider. When the
 * college moves to Google Workspace, an OidcAuthProvider is added HERE —
 * it verifies the Google id-token, matches the existing account by email
 * via relinkIdentityByEmail, and returns the same stable internal user
 * id. Nothing outside this package changes: the user id is never the
 * email, so every course, snapshot, role and audit row keeps pointing at
 * the same account.
 */

export type Credentials =
  | { kind: 'password'; email: string; password: string }
  /** Reserved for the Phase-3 OIDC implementation. */
  | { kind: 'oidc'; idToken: string };

export type AuthOutcome =
  | {
      ok: true;
      userId: string;
      /** The app must route to the change-password screen before anything else. */
      mustChangePassword: boolean;
    }
  | {
      ok: false;
      /**
       * Deliberately coarse: INVALID_CREDENTIALS covers "no such account"
       * and "wrong password" identically, so responses cannot be used to
       * enumerate accounts. WRONG_PROVIDER guides an SSO-migrated user to
       * the SSO button without confirming the password was right.
       */
      reason: 'INVALID_CREDENTIALS' | 'ACCOUNT_INACTIVE' | 'WRONG_PROVIDER';
    };

export interface AuthProvider {
  /** Matches User.identityProvider values this provider can verify. */
  readonly provider: 'LOCAL' | 'GOOGLE';
  authenticate(credentials: Credentials): Promise<AuthOutcome>;
}
