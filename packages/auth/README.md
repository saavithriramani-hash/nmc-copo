# @copo/auth

Authentication and authorisation for the CO-PO attainment application.
Depends on `@copo/db`; nothing else depends on how identity works.

## Authentication (Phase 1: local accounts)

- **Administrator-created accounts only** — no self-registration path
  exists in this package. `AccountService.createUser` returns a one-time
  temporary password; `mustChangePassword` forces a change at first login.
- **argon2id** (OWASP profile: 19 MiB, t=2, p=1) via `@node-rs/argon2`;
  hashes embed their parameters, `needsRehash` flags stragglers.
- **Administrator-initiated reset** issues a fresh temporary password and
  revokes every session.
- **Sessions**: opaque 256-bit tokens; the database stores only a SHA-256
  hash. Idle timeout 30 min, absolute cap 12 h (configurable), revocation
  on logout / password change / reset / deactivation (NFR-10).
- **Bootstrap**: `npm run create-admin -- <email> "<name>"` creates the
  first administrator (refuses if one exists); everything after goes
  through the guarded services.

## Built for the Google Workspace migration (§2.1)

- Every user carries `identityProvider` (`LOCAL` now) and a **stable
  internal id that is never the email**.
- All verification sits behind the `AuthProvider` interface;
  `LocalAuthProvider` is today's only implementation. The Phase-3 OIDC
  provider is added inside this package: verify the Google id-token, call
  `relinkIdentityByEmail` (already implemented and tested), get back the
  same internal user id. Accounts are matched by email and re-pointed —
  no re-creation, no loss of audit history, and the local password hash
  is cleared. Nothing outside `packages/auth` changes.

## Authorisation — one policy, one enforcement point

- `src/authz/actions.ts` — the complete catalogue of authorisable actions.
- `src/authz/policy.ts` — the §2 role table as a single pure,
  deny-by-default function. **No permission logic exists anywhere else.**
- `src/authz/guard.ts` — the server-side choke point:
  `guard.require(userId, action)` in every route handler / server action.
  Page components never carry checks; they render what the server already
  authorised. Denials are audit-logged; a guessed or nonexistent id
  denies with `RESOURCE_NOT_FOUND` (absence is never an existence oracle,
  never an allow).
- **Effect dates**: role assignments have `[effectiveFrom, effectiveTo)`
  windows; revocation closes the window, never deletes. `guard.check(…,
  at)` answers "who could do this when the snapshot was taken".
  Scope shape (HoD→department, every other role→none) is a database
  CHECK constraint.

| Role | Scope enforced |
|---|---|
| Faculty | Own courses only (instructor rows); edits only while DRAFT. **Not who teaches the course** |
| HoD | Every course in their department **and every programme of it**: PO/PSOs, articulation matrices, programme *and* course parameter overrides; lock/unlock; **staffing (`course.staff`)** |
| Dean | Read-all (courses, programmes, departments, institution) + **the institution attainment parameters** + audit log. No raw marks |
| IQAC | **Read-only**: the same read surface as the Dean, minus `settings.institution.write`. No raw marks |
| Principal | Read-only consolidations/dashboards. No course detail, no marks |
| System administrator | Accounts, roles, departments, rollover, backups, audit log. **No academic data at all** |

## Confirmed scope decisions (ratified 24 Jul 2026)

Raised as interpretation questions during implementation and confirmed;
changing any of them is now a change request against this baseline.

> **CR-1 (30 Jul 2026)** revised the §2 role table itself: the programme
> coordinator was removed (the HoD covers every programme of their
> department), IQAC became read-only, and DEAN was added holding what
> IQAC previously held. Decision 5 below is restated accordingly; the
> rest stand unchanged. The migration **deletes** existing coordinator
> assignments, so that role history does not survive.

1. **Raw marks follow NFR-10 strictly** — "visible only to the course
   faculty and their department chain" means faculty(own) + HoD(dept)
   and nobody else; the §2 "read-all" roles cover setup, results and
   consolidations, not per-student marks.
2. **Principal** gets consolidation reads only ("read-only dashboards"),
   not per-course drill-down.
3. **Admin holds no academic data access** (separation of duties; §2
   lists only accounts/departments/rollover/backups).
4. **Submitted courses freeze faculty edits** while the HoD reviews;
   LOCKED freezes everyone (unlock creates a new version).
5. **Parameter overrides**: institution → the Dean; programme *and*
   course (minuted exception) → the HoD of that department.
6. **Staffing is departmental, not the course's own** (`course.staff`,
   HoD only). FR-4 makes assigned faculty part of *creating* a course and
   `course.create` is HoD-only; §2 gives Faculty setup, mark entry,
   compute, export and submit — not staffing. This was originally folded
   into `course.write`, which let an instructor grant any faculty member
   in the college read/write access to that course's per-student marks
   (defeating NFR-10), remove a colleague the HoD had posted, or strand
   the course by removing themselves.

## Tests (61, no database needed)

`npm test` — the policy matrix role-by-role; guard proofs that a faculty
account cannot reach another department's marks by **any** catalogued
action, with real ids, colleague ids, and **guessed ids** (denied
identically, audit-logged); role effect-date time travel; argon2
round-trips and seed-placeholder safety; session expiry/idle/revocation;
full account lifecycle including the forced first-login change and the
Google re-pointing path.
