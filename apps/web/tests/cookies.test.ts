import { describe, expect, it } from 'vitest';
import { sessionCookieSecure } from '../lib/cookies';

/**
 * The session cookie's `Secure` flag.
 *
 * The failure this guards against is silent and total: a production build
 * served over plain HTTP marks the cookie Secure, the browser discards
 * it, and every user outside the server itself is bounced back to the
 * login screen having apparently signed in successfully. It works on
 * localhost — which browsers treat as trustworthy — so it survives
 * testing on the machine that deployed it.
 */
const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;

describe('sessionCookieSecure — the default', () => {
  it('is secure in production, where TLS is expected', () => {
    expect(sessionCookieSecure(env({ NODE_ENV: 'production' }))).toBe(true);
  });

  it('is not secure in development, which is plain HTTP', () => {
    expect(sessionCookieSecure(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(sessionCookieSecure(env({}))).toBe(false);
  });
});

describe('sessionCookieSecure — the override', () => {
  it('can be turned off for an HTTP-only deployment', () => {
    // The campus LAN case: a real production build, no TLS in front.
    for (const value of ['false', '0', 'no', 'off', 'FALSE', 'Off', '  false  ']) {
      expect(sessionCookieSecure(env({ NODE_ENV: 'production', COPO_COOKIE_SECURE: value })), value).toBe(false);
    }
  });

  it('can be turned on explicitly, even outside a production build', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE', 'On']) {
      expect(sessionCookieSecure(env({ NODE_ENV: 'development', COPO_COOKIE_SECURE: value })), value).toBe(true);
    }
  });
});

describe('sessionCookieSecure — a typo must never weaken it', () => {
  it('ignores a value nobody recognises and keeps the safe default', () => {
    // "flase", "disabled", a stray quote from an .env file — every one of
    // these must leave a production deployment secure rather than guess.
    for (const value of ['flase', 'disabled', 'nope', '"false"', 'F', '2', 'null']) {
      expect(sessionCookieSecure(env({ NODE_ENV: 'production', COPO_COOKIE_SECURE: value })), value).toBe(true);
    }
  });

  it('treats an empty or whitespace value as unset', () => {
    for (const value of ['', '   ']) {
      expect(sessionCookieSecure(env({ NODE_ENV: 'production', COPO_COOKIE_SECURE: value })), JSON.stringify(value)).toBe(true);
    }
  });

  it('never lets the override alone make a development build secure by accident', () => {
    // Nothing here is a security risk, but it pins the precedence: an
    // explicit setting wins, an unrecognised one does not.
    expect(sessionCookieSecure(env({ NODE_ENV: 'development', COPO_COOKIE_SECURE: 'flase' }))).toBe(false);
  });
});
