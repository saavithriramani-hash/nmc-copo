import { describe, expect, it } from 'vitest';
import { AuthError, DEFAULT_SESSION_CONFIG, SessionService, evaluateSession } from '../src/index';
import { FakePrisma } from './fixtures/fakePrisma';

const T0 = new Date('2026-07-24T09:00:00Z');
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('evaluateSession — pure liveness rule', () => {
  const record = (over: Partial<{ expiresAt: Date; lastSeenAt: Date; revokedAt: Date | null }> = {}) => ({
    expiresAt: plus(T0, 12 * HOUR),
    lastSeenAt: T0,
    revokedAt: null,
    ...over,
  });

  it('live within all limits', () => {
    expect(evaluateSession(record(), plus(T0, 5 * MIN), DEFAULT_SESSION_CONFIG)).toBe('LIVE');
  });

  it('revocation wins over everything', () => {
    expect(evaluateSession(record({ revokedAt: plus(T0, 1 * MIN) }), plus(T0, 13 * HOUR), DEFAULT_SESSION_CONFIG)).toBe(
      'REVOKED',
    );
  });

  it('exactly at absolute expiry → expired (inclusive)', () => {
    expect(evaluateSession(record(), plus(T0, 12 * HOUR), DEFAULT_SESSION_CONFIG)).toBe('EXPIRED');
  });

  it('idle: exactly at the idle limit is still live; one ms past times out', () => {
    expect(evaluateSession(record(), plus(T0, 30 * MIN), DEFAULT_SESSION_CONFIG)).toBe('LIVE');
    expect(evaluateSession(record(), plus(T0, 30 * MIN + 1), DEFAULT_SESSION_CONFIG)).toBe('IDLE_TIMED_OUT');
  });
});

describe('SessionService', () => {
  function make() {
    const db = new FakePrisma();
    const service = new SessionService(db.asClient());
    return { db, service };
  }

  it('creates a session and validates its token; the DB stores only a hash', async () => {
    const { db, service } = make();
    const { token, sessionId } = await service.create('user-1', {}, T0);
    expect(db.sessions[0]?.tokenHash).not.toBe(token);
    expect(db.sessions[0]?.tokenHash).toHaveLength(64); // sha256 hex

    const live = await service.validate(token, plus(T0, 1 * MIN));
    expect(live).toEqual({ sessionId, userId: 'user-1' });
  });

  it('rejects a tampered token', async () => {
    const { service } = make();
    const { token } = await service.create('user-1', {}, T0);
    await expect(service.validate(token.slice(0, -2) + 'xx', plus(T0, 1 * MIN))).rejects.toThrow(AuthError);
  });

  it('enforces absolute expiry and idle timeout', async () => {
    const { service } = make();
    const { token } = await service.create('user-1', {}, T0);
    await expect(service.validate(token, plus(T0, 12 * HOUR))).rejects.toMatchObject({ reason: 'SESSION_EXPIRED' });

    const second = await service.create('user-2', {}, T0);
    await expect(service.validate(second.token, plus(T0, 31 * MIN))).rejects.toMatchObject({
      reason: 'SESSION_EXPIRED',
    });
  });

  it('touches lastSeenAt at most once per touch interval', async () => {
    const { db, service } = make();
    const { token } = await service.create('user-1', {}, T0);

    await service.validate(token, plus(T0, 30 * 1000)); // inside the 60s throttle
    expect(db.sessionUpdateCalls).toBe(0);

    await service.validate(token, plus(T0, 90 * 1000)); // past it → one write
    expect(db.sessionUpdateCalls).toBe(1);
    expect(db.sessions[0]?.lastSeenAt).toEqual(plus(T0, 90 * 1000));
  });

  it('a touched session stays alive past the original idle horizon', async () => {
    const { service } = make();
    const { token } = await service.create('user-1', {}, T0);
    await service.validate(token, plus(T0, 25 * MIN)); // activity at +25m
    await expect(service.validate(token, plus(T0, 50 * MIN))).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('revoke kills one session; revokeAllForUser kills every live one and reports the count', async () => {
    const { service } = make();
    const a = await service.create('user-1', {}, T0);
    const b = await service.create('user-1', {}, T0);
    const other = await service.create('user-2', {}, T0);

    await service.revoke(a.sessionId, plus(T0, 1 * MIN));
    await expect(service.validate(a.token, plus(T0, 2 * MIN))).rejects.toMatchObject({ reason: 'SESSION_INVALID' });
    await expect(service.validate(b.token, plus(T0, 2 * MIN))).resolves.toBeDefined();

    const count = await service.revokeAllForUser('user-1', plus(T0, 3 * MIN));
    expect(count).toBe(1); // b only — a was already revoked
    await expect(service.validate(b.token, plus(T0, 4 * MIN))).rejects.toThrow(AuthError);
    await expect(service.validate(other.token, plus(T0, 4 * MIN))).resolves.toBeDefined(); // untouched
  });
});
