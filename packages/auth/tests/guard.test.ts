import { describe, expect, it } from 'vitest';
import { AuthzDeniedError, COURSE_ACTION_TYPES, Guard, MemoryAuditSink } from '../src/index';
import { FakeContextSource, type FakeUser } from './fixtures/world';

/**
 * Guard tests: the enforcement point exercised exactly as a route
 * handler will call it — by user id and resource id, nothing pre-loaded.
 * This is the "direct API call" proof minus only the HTTP framing: a
 * request with any guessed, borrowed or expired identifier is refused.
 */

const SINCE_2024 = new Date('2024-06-01T00:00:00Z');

const users: FakeUser[] = [
  {
    id: 'fac-math-1',
    isActive: true,
    roles: [{ kind: 'FACULTY', departmentId: null, effectiveFrom: SINCE_2024, effectiveTo: null }],
  },
  {
    id: 'hod-past',
    isActive: true,
    roles: [
      {
        kind: 'HOD',
        departmentId: 'dept-math',
        effectiveFrom: new Date('2023-06-01T00:00:00Z'),
        effectiveTo: new Date('2025-05-31T00:00:00Z'), // stepped down
      },
    ],
  },
  {
    id: 'hod-future',
    isActive: true,
    roles: [
      {
        kind: 'HOD',
        departmentId: 'dept-math',
        effectiveFrom: new Date('2027-06-01T00:00:00Z'), // not yet in post
        effectiveTo: null,
      },
    ],
  },
];

function makeGuard() {
  const audit = new MemoryAuditSink();
  const guard = new Guard(new FakeContextSource(users), audit);
  return { guard, audit };
}

describe('Guard — a faculty account cannot reach another department’s marks by any route', () => {
  it('denies marks.read on a real course of another department', async () => {
    const { guard, audit } = makeGuard();
    await expect(guard.require('fac-math-1', { type: 'marks.read', courseId: 'c-phys-1' })).rejects.toThrow(
      AuthzDeniedError,
    );
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: 'AUTHZ_DENIED',
      actorId: 'fac-math-1',
      entityId: 'c-phys-1',
      after: { attempted: 'marks.read', reason: 'OUT_OF_SCOPE' },
    });
  });

  it('denies EVERY course-scoped action against that course — no route in the catalogue gets through', async () => {
    const { guard } = makeGuard();
    for (const type of COURSE_ACTION_TYPES) {
      await expect(guard.require('fac-math-1', { type, courseId: 'c-phys-1' }), type).rejects.toThrow(AuthzDeniedError);
    }
  });

  it('denies a GUESSED course id identically — absence is not an oracle, and never an allow', async () => {
    const { guard, audit } = makeGuard();
    try {
      await guard.require('fac-math-1', { type: 'marks.read', courseId: 'c-guessed-000001' });
      expect.unreachable('guard must deny');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzDeniedError);
      expect((err as AuthzDeniedError).reason).toBe('RESOURCE_NOT_FOUND');
    }
    expect(audit.events[0]?.after).toMatchObject({ reason: 'RESOURCE_NOT_FOUND' });
  });

  it('denies colleague-course marks in the SAME department too (own courses only)', async () => {
    const { guard } = makeGuard();
    await expect(guard.require('fac-math-1', { type: 'marks.read', courseId: 'c-math-2' })).rejects.toThrow(
      AuthzDeniedError,
    );
  });

  it('allows their own course, and allows are not audit-logged here', async () => {
    const { guard, audit } = makeGuard();
    await expect(guard.require('fac-math-1', { type: 'marks.read', courseId: 'c-math-1' })).resolves.toBeUndefined();
    expect(audit.events).toHaveLength(0);
  });

  it('denies an unknown user id outright', async () => {
    const { guard } = makeGuard();
    await expect(guard.require('u-guessed', { type: 'marks.read', courseId: 'c-math-1' })).rejects.toThrow(
      AuthzDeniedError,
    );
  });
});

describe('Guard — role effect dates (§2: staff change hands between cycles)', () => {
  it('an HoD who stepped down in 2025 has no access today…', async () => {
    const { guard } = makeGuard();
    await expect(guard.require('hod-past', { type: 'marks.read', courseId: 'c-math-1' })).rejects.toThrow(
      AuthzDeniedError,
    );
  });

  it('…but the record still shows they held the role when a 2024 course was computed', async () => {
    const { guard } = makeGuard();
    const decision = await guard.check(
      'hod-past',
      { type: 'course.read', courseId: 'c-math-1' },
      new Date('2024-11-15T00:00:00Z'), // instant of the historical computation
    );
    expect(decision).toEqual({ allow: true, via: 'HOD' });
  });

  it('a future-dated appointment grants nothing yet', async () => {
    const { guard } = makeGuard();
    await expect(guard.require('hod-future', { type: 'course.read', courseId: 'c-math-1' })).rejects.toThrow(
      AuthzDeniedError,
    );
    const later = await guard.check(
      'hod-future',
      { type: 'course.read', courseId: 'c-math-1' },
      new Date('2027-07-01T00:00:00Z'),
    );
    expect(later.allow).toBe(true);
  });
});

describe('Guard — check() vs require()', () => {
  it('check returns the decision without throwing or logging', async () => {
    const { guard, audit } = makeGuard();
    const decision = await guard.check('fac-math-1', { type: 'course.lock', courseId: 'c-math-1' });
    expect(decision.allow).toBe(false);
    expect(audit.events).toHaveLength(0);
  });
});
