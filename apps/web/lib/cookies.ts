/**
 * Whether the session cookie is marked `Secure`.
 *
 * A `Secure` cookie is only accepted by the browser over HTTPS — with one
 * exception, `localhost`, which browsers treat as a trustworthy origin
 * even on plain HTTP. That exception is a trap: the deployed application
 * works perfectly when opened on the server itself and silently fails for
 * everyone else. Login appears to succeed, the browser discards the
 * cookie, the next request arrives with no session, and the user is sent
 * back to the login screen with no explanation.
 *
 * The college server currently serves plain HTTP on the campus network,
 * so it needs this off; a deployment behind TLS needs it on. Hence a
 * setting rather than a constant.
 *
 * **Turning this off means the session cookie travels in clear over the
 * network**, where anyone able to observe campus traffic could copy it
 * and act as that user. It is a stopgap for an HTTP deployment, not a
 * setting to leave alone once TLS is available.
 */
export function sessionCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.COPO_COOKIE_SECURE ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
  // Unset, or a value nobody recognises: fall back to the safe default —
  // secure whenever this is a production build. A typo must never be the
  // thing that quietly disables it.
  return env.NODE_ENV === 'production';
}
