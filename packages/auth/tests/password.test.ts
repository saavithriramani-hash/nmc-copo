import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  generateTemporaryPassword,
  hashPassword,
  needsRehash,
  validateNewPassword,
  verifyPassword,
} from '../src/index';

describe('password hashing (argon2id)', () => {
  it('hashes and verifies a round trip; rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery stable')).toBe(false);
  });

  it('a malformed stored hash is a failed login, never a crash (seed placeholders)', async () => {
    expect(await verifyPassword('DEV-PLACEHOLDER', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('fresh hashes carry the current cost profile; foreign hashes report needsRehash', async () => {
    const hash = await hashPassword('some password here');
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=3,p=1$abc$def')).toBe(true);
  });
});

describe('temporary passwords', () => {
  it('match the XXXX-XXXX-XXXX shape from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateTemporaryPassword()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it('never contain the ambiguous characters 0, O, 1, I, L', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateTemporaryPassword()).not.toMatch(/[0O1IL]/);
    }
  });
});

describe('password policy', () => {
  it(`requires ${MIN_PASSWORD_LENGTH}+ characters`, () => {
    expect(validateNewPassword('short')).not.toEqual([]);
    expect(validateNewPassword('long enough indeed')).toEqual([]);
  });

  it('rejects the email as password and single repeated characters', () => {
    expect(validateNewPassword('user@nmc.dev', { email: 'USER@NMC.DEV' })).not.toEqual([]);
    expect(validateNewPassword('aaaaaaaaaaaa')).not.toEqual([]);
  });
});
