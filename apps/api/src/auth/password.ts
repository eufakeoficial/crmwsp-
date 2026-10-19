import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt (node:crypto, no dependency). N=2^15, r=8, p=1 => 32 MiB per hash.
// Format: scrypt$ln=15,r=8,p=1$<salt b64>$<hash b64>
const LN = 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAX_MEM = 64 * 1024 * 1024;
const FORMAT_RE = /^scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function derive(password: string, salt: Buffer, ln: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLen, { N: 2 ** ln, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, LN, R, P, KEY_LEN);
  return `scrypt$ln=${LN},r=${R},p=${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time verification. Malformed or out-of-range parameters return false. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const m = FORMAT_RE.exec(stored);
  if (!m) return false;
  const [ln, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (ln < 14 || ln > 17 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  const salt = Buffer.from(m[4] ?? "", "base64");
  const expected = Buffer.from(m[5] ?? "", "base64");
  if (salt.length < 16 || expected.length < 16 || expected.length > 64) return false;
  const actual = await derive(password, salt, ln, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}
