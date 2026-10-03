// PINs and session tokens. Pure functions so they're testable without Next.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ponytail: a 4-digit PIN is only 10k combos. Online guessing is capped by the lockout in app/actions.ts;
// the server-side pepper means a leaked DB alone can't be brute-forced. Upgrade path: longer PINs / passkeys.
export function hashPin(pin: string, pepper: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(`${pin}:${pepper}`, salt, 32).toString("hex")}`;
}

export function checkPin(pin: string, stored: string, pepper: string) {
  const [salt, hash] = stored.split(":");
  const got = scryptSync(`${pin}:${pepper}`, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(got, Buffer.from(hash, "hex"));
}

const mac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export type Session = { id: string; name: string };

/** token = id.name.expiry.hmac (ids are uuids, names are [a-z0-9_], so "." is a safe separator) */
export function signSession(s: Session, secret: string, ttlSec: number, now = Date.now()) {
  const data = `${s.id}.${s.name}.${Math.floor(now / 1000) + ttlSec}`;
  return `${data}.${mac(data, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): Session | null {
  const parts = token?.split(".");
  if (parts?.length !== 4) return null;
  const [id, name, exp, sig] = parts;
  const want = Buffer.from(mac(`${id}.${name}.${exp}`, secret));
  const have = Buffer.from(sig);
  if (want.length !== have.length || !timingSafeEqual(want, have)) return null;
  return Number(exp) * 1000 > now ? { id, name } : null;
}
