import { cookies } from "next/headers";
import { signSession, verifySession, type Session } from "./crypto";

const SECRET = process.env.SESSION_SECRET ?? "";
export const PEPPER = SECRET;
const TTL = 60 * 60 * 24 * 90; // 90 days

export async function getSession() {
  const token = (await cookies()).get("cp_session")?.value; // read cookies first: keeps pages dynamic even without a secret
  return SECRET ? verifySession(token, SECRET) : null;
}

/** Call only from Server Actions / Route Handlers. */
export async function startSession(s: Session) {
  if (!SECRET) throw new Error("SESSION_SECRET not set");
  const jar = await cookies();
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: TTL };
  jar.set("cp_session", signSession(s, SECRET, TTL), opts);
  jar.set("cp_name", s.name, { ...opts, maxAge: 60 * 60 * 24 * 365 }); // remembers who you are → PIN-only login
}
