import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The first-administrator route, guarded as source.
 *
 * It cannot be exercised here — it needs a database and a built Next
 * runtime — but the one property that matters is a property of the code:
 * it must refuse when no token is configured. Asserted as text so it
 * cannot be quietly undone, in the manner of the ops-script tests.
 */
const route = readFileSync(
  path.join(__dirname, '..', 'app', 'api', 'bootstrap', 'admin', 'route.ts'),
  'utf8',
);

describe('POST /api/bootstrap/admin — the one account nobody can authorise', () => {
  it('REFUSES when no bootstrap token is configured', () => {
    // The hole this closes: `if (expectedToken && ...)` skipped the check
    // whenever the variable was unset — and compose passes an empty
    // string by default, which is falsy. On a VPS deployed from a hosting
    // panel the application is on a public address from the moment it
    // starts, so the first stranger to find this route became the
    // administrator of the college's attainment system.
    expect(route).toMatch(/if\s*\(\s*!expectedToken\s*\)/);
    expect(route).toContain('BOOTSTRAP_TOKEN is not set');
  });

  it('still compares the token when one IS configured', () => {
    expect(route).toContain("request.headers.get('x-bootstrap-token') !== expectedToken");
  });

  it('locks itself permanently once an administrator exists', () => {
    expect(route).toContain("kind: 'ADMIN'");
    expect(route).toContain('status: 409');
  });

  it('never lets the caller choose the password', () => {
    // A temporary password is generated, returned once, and must be
    // changed at first sign-in. A caller-supplied password would survive
    // in whatever deployment note it was typed into.
    expect(route).toContain('generateTemporaryPassword()');
    expect(route).toContain('mustChangePassword: true');
    expect(route).not.toMatch(/body\.password|body\?\.password/);
  });
});
