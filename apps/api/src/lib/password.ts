import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Hand-wrapped rather than promisify()'d: promisify collapses scrypt's
// overloads and drops the options argument that carries the cost parameters.
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * argon2id would be the textbook first choice, but every Node binding for it is
 * a native module. scrypt is memory-hard, is in core, needs no compiler on the
 * deploy host, and adds nothing to the dependency tree that could be
 * compromised. OWASP lists it as an acceptable choice.
 *
 * N = 2^15 costs about 32 MB per hash. That is deliberately restrained: the
 * production API runs in a 512 MB container, and a higher cost factor would
 * turn a handful of concurrent logins into an out-of-memory crash. Login and
 * registration are rate limited to keep the work bounded.
 */
const PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  // 128 * N * r = 32 MB; the default maxmem of 32 MB would reject it by a hair.
  maxmem: 64 * 1024 * 1024,
} as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PARAMS.saltLength);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, PARAMS.keyLength, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: PARAMS.maxmem,
  });

  // Parameters travel with the hash so they can be raised later without
  // invalidating every existing password.
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: PARAMS.maxmem,
  });

  // Lengths are equal by construction, but timingSafeEqual throws if they are
  // not, and a throw here would leak the mismatch through the error path.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A precomputed hash of a value nobody can supply, used to spend the same work
 * on a login for an address that does not exist. Without this, "no such user"
 * returns noticeably faster than "wrong password" and the login endpoint
 * becomes an account-enumeration oracle.
 */
let dummyHash: string | undefined;

export async function wastePasswordTime(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomBytes(32).toString("hex"));
  await verifyPassword(password, dummyHash);
}
