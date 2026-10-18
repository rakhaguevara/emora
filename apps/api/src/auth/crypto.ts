import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Hash password dan PIN dengan scrypt (bawaan Node, tanpa dependensi tambahan).
// Format tersimpan: scrypt$<salt hex>$<hash hex>

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 64;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Hash pembanding untuk username yang tidak ada, agar waktu respons login tidak membocorkan keberadaan akun.
export const DUMMY_HASH = await hashSecret(randomBytes(16).toString('hex'));

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const PIN_LENGTH = 6;
export const generatePin = () => String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
