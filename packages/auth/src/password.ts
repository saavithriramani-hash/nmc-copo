import { randomBytes, randomInt } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Password hashing: argon2id with the OWASP-recommended cost profile
 * (19 MiB memory, 2 iterations, parallelism 1). Hashes embed their own
 * parameters, so these can be raised later without invalidating stored
 * hashes; needsRehash() reports stragglers at login time.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Constant-time verification. A malformed stored hash (e.g. a seed
 * placeholder) is a failed login, never a crash.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/** True when the stored hash predates the current cost profile. */
export function needsRehash(storedHash: string): boolean {
  // argon2 encoded form: $argon2id$v=19$m=19456,t=2,p=1$...
  return !storedHash.startsWith(`$argon2id$v=19$m=${ARGON2_OPTIONS.memoryCost},t=${ARGON2_OPTIONS.timeCost},p=${ARGON2_OPTIONS.parallelism}$`);
}

/**
 * A dummy hash verified against when the account does not exist, so a
 * login attempt takes the same time either way (no user enumeration by
 * timing). Computed once at module load.
 */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword(randomBytes(16).toString('hex'));

/** Unambiguous alphabet: no 0/O, 1/I/L. */
const TEMP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Administrator-issued temporary password, e.g. "K7RW-M3PQ-X24H".
 * ~15 bits of entropy per group from a CSPRNG; always paired with
 * mustChangePassword = true, so it lives only until first login.
 */
export function generateTemporaryPassword(): string {
  const group = () =>
    Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Password policy for user-chosen passwords. Returns human-readable
 * problems; empty array = acceptable.
 */
export function validateNewPassword(password: string, context: { email?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (context.email && password.toLowerCase() === context.email.toLowerCase()) {
    problems.push('must not be the email address');
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push('must not be a single repeated character');
  }
  return problems;
}
