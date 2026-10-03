"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPin, hashPin } from "@/lib/crypto";
import { MAX_PER_USER, MAX_ROUTES, ObjectId, col, type LogDoc, type Place, type RouteDoc, type UserDoc } from "@/lib/db";
import { slugify } from "@/lib/pain";
import { PEPPER, getSession, startSession } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

const MAX_TRIES = 5;
const LOCK_MIN = 15;

/** One door for both: unknown name → new player, known name → PIN check. */
export async function enter(_: FormState, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim().toLowerCase();
  const pin = String(form.get("pin") ?? "");
  if (!/^[a-z0-9_]{2,20}$/.test(name)) return { error: "name: 2–20 chars, letters/numbers/_ only" };
  if (!/^\d{4}$/.test(pin)) return { error: "PIN = exactly 4 digits" };

  try {
    const users = await col<UserDoc>("users");
    const user = await users.findOne({ name });

    if (!user) {
      const { insertedId } = await users.insertOne({
        _id: new ObjectId(), name, pin_hash: hashPin(pin, PEPPER), failed_pins: 0, locked_until: null, created_at: new Date(),
      });
      await startSession({ id: insertedId.toHexString(), name });
    } else {
      if (user.locked_until && user.locked_until > new Date()) {
        return { error: `too many wrong PINs 🔒 try again in ${Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000)} min` };
      }
      if (!checkPin(pin, user.pin_hash, PEPPER)) {
        const after = await users.findOneAndUpdate({ _id: user._id }, { $inc: { failed_pins: 1 } }, { returnDocument: "after" });
        const fails = after?.failed_pins ?? MAX_TRIES;
        if (fails >= MAX_TRIES) {
          await users.updateOne({ _id: user._id }, { $set: { failed_pins: 0, locked_until: new Date(Date.now() + LOCK_MIN * 60_000) } });
          return { error: `locked for ${LOCK_MIN} min 🔒` };
        }
        return { error: `wrong PIN (${MAX_TRIES - fails} tries left)` };
      }
      if (user.failed_pins) await users.updateOne({ _id: user._id }, { $set: { failed_pins: 0, locked_until: null } });
      await startSession({ id: user._id.toHexString(), name: user.name });
    }
  } catch (e) {
    console.error(e);
    return { error: (e as { code?: number }).code === 11000 ? "name just got taken, try again" : "server hiccup, try again" };
  }
  redirect("/leave");
}

export async function logout() {
  (await cookies()).delete("cp_session");
  redirect("/");
}

/** "not you?" — forget the remembered name too. */
export async function forget() {
  const jar = await cookies();
  jar.delete("cp_session");
  jar.delete("cp_name");
  redirect("/");
}

function parsePlace(raw: FormDataEntryValue | null): Place | null {
  try {
    const p = JSON.parse(String(raw));
    const ok = typeof p.label === "string" && p.label.length <= 200 &&
      p.lat > 16.8 && p.lat < 18.2 && p.lng > 77.8 && p.lng < 79.2; // greater Hyderabad only
    return ok ? { label: p.label.trim().slice(0, 120), lat: +p.lat, lng: +p.lng } : null;
  } catch {
    return null;
  }
}

export async function addCommute(_: FormState, form: FormData): Promise<FormState> {
  const me = await getSession();
  if (!me) redirect("/");
  const from = parsePlace(form.get("from")), to = parsePlace(form.get("to"));
  if (!from || !to) return { error: "pick both places from the search results (Hyderabad only)" };
  if (Math.hypot(from.lat - to.lat, from.lng - to.lng) < 0.005) return { error: "that's… the same place. walk? 🚶" };

  try {
    const routes = await col<RouteDoc>("routes");
    const owner_id = new ObjectId(me.id);
    if ((await routes.countDocuments({ owner_id })) >= MAX_PER_USER) return { error: `max ${MAX_PER_USER} commutes per player` };
    if ((await routes.countDocuments({ active: true })) >= MAX_ROUTES) return { error: "server's full (free-tier traffic budget) 😭 try later" };

    const short = (s: string) => {
      const head = s.split(",")[0].trim();
      return head.length <= 28 ? head : `${head.slice(0, 28).replace(/\s+\S*$/, "")}…`; // cut on a word boundary
    };
    // ponytail: max+1 channel number can collide under simultaneous adds; harmless (display only).
    const [top] = await routes.find().sort({ ch: -1 }).limit(1).toArray();
    await routes.insertOne({
      _id: new ObjectId(),
      slug: `${me.name}-${slugify(short(to.label))}-${Math.random().toString(36).slice(2, 6)}`,
      ch: (top?.ch ?? 0) + 1,
      name: `${short(from.label)}→${short(to.label)}`,
      owner_id, owner_name: me.name, origin: from, dest: to, active: true, created_at: new Date(),
    });
  } catch (e) {
    console.error(e);
    return { error: "couldn't save, try again" };
  }
  revalidatePath("/me");
  return { ok: "added! the logger picks it up within 30 min 🛰️" };
}

export async function deleteCommute(form: FormData) {
  const me = await getSession();
  if (!me) redirect("/");
  const id = String(form.get("id"));
  if (ObjectId.isValid(id)) {
    const { deletedCount } = await (await col<RouteDoc>("routes")).deleteOne({ _id: new ObjectId(id), owner_id: new ObjectId(me.id) });
    if (deletedCount) await (await col<LogDoc>("commute_logs")).deleteMany({ route_id: new ObjectId(id) });
  }
  revalidatePath("/me");
}
