/**
 * Password hashing with Node's built-in scrypt (no dependency). The stored
 * string carries its parameters, so they can be raised later without
 * invalidating existing hashes: `scrypt$N$r$p$<salt b64>$<hash b64>`.
 */
import {randomBytes, randomInt, scrypt, timingSafeEqual} from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFC'),
      salt,
      keyLength,
      {N: n, r, p, maxmem: 256 * n * r + 1024 * 1024},
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every(v => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4] as string, 'base64');
  const expected = Buffer.from(parts[5] as string, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await derive(password, salt, n, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when the user does not exist, so the
 * response time does not reveal which display names are valid.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('oxeye-dummy-password');
  await verifyPassword(password, await dummyHash);
  return false;
}

// No 0/O, 1/l/i: easy to read aloud and to type on a phone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Random password like `k7mq-x2fd-9hta` (~59 bits). */
export function generatePassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return groups.join('-');
}
