"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkPin, hashPin } from "@/lib/crypto";
import { MAX_PER_USER, MAX_ROUTES, sb } from "@/lib/db";
import { slugify } from "@/lib/pain";
import { PEPPER, getSession, startSession } from "@/lib/session";

type User = { id: string; name: string; pin_hash: string; failed_pins: number; locked_until: string | null };
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
    const [user] = await sb<User[]>(`/rest/v1/users?name=eq.${name}&select=id,name,pin_hash,failed_pins,locked_until`);
    const patch = (body: object) =>
      sb(`/rest/v1/users?id=eq.${user.id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

    if (!user) {
      const [created] = await sb<User[]>("/rest/v1/users", {
        method: "POST",
        body: JSON.stringify({ name, pin_hash: hashPin(pin, PEPPER) }),
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      });
      await startSession({ id: created.id, name });
    } else {
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const mins = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000);
        return { error: `too many wrong PINs 🔒 try again in ${mins} min` };
      }
      if (!checkPin(pin, user.pin_hash, PEPPER)) {
        // ponytail: read-then-write counter, parallel guesses can slip 1–2 extra tries. RPC with atomic increment if it matters.
        const fails = user.failed_pins + 1;
        await patch(fails >= MAX_TRIES ? { failed_pins: 0, locked_until: new Date(Date.now() + LOCK_MIN * 60_000).toISOString() } : { failed_pins: fails });
        return { error: fails >= MAX_TRIES ? `locked for ${LOCK_MIN} min 🔒` : `wrong PIN (${MAX_TRIES - fails} tries left)` };
      }
      if (user.failed_pins) await patch({ failed_pins: 0, locked_until: null });
      await startSession({ id: user.id, name: user.name });
    }
  } catch (e) {
    console.error(e);
    return { error: "server hiccup, try again" };
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

type Place = { label: string; lat: number; lng: number };

function parsePlace(raw: FormDataEntryValue | null): Place | null {
  try {
    const p = JSON.parse(String(raw));
    const ok = typeof p.label === "string" && p.label.length <= 80 &&
      p.lat > 16.8 && p.lat < 18.2 && p.lng > 77.8 && p.lng < 79.2; // greater Hyderabad only
    return ok ? { label: p.label.trim(), lat: +p.lat, lng: +p.lng } : null;
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
    const mine = await sb<unknown[]>(`/rest/v1/routes?owner_id=eq.${me.id}&select=id`);
    if (mine.length >= MAX_PER_USER) return { error: `max ${MAX_PER_USER} commutes per player` };
    const all = await sb<unknown[]>("/rest/v1/routes?active=eq.true&select=id");
    if (all.length >= MAX_ROUTES) return { error: "server's full (free-tier traffic budget) 😭 try later" };

    const short = (s: string) => s.split(",")[0].slice(0, 30);
    const name = `${short(from.label)}→${short(to.label)}`;
    await sb("/rest/v1/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        slug: `${me.name}-${slugify(short(to.label))}-${Math.random().toString(36).slice(2, 6)}`,
        name, owner_id: me.id, origin_label: from.label, dest_label: to.label,
        origin_lat: from.lat, origin_lng: from.lng, dest_lat: to.lat, dest_lng: to.lng,
      }),
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
  const id = Number(form.get("id"));
  if (Number.isInteger(id)) await sb(`/rest/v1/routes?id=eq.${id}&owner_id=eq.${me.id}`, { method: "DELETE" });
  revalidatePath("/me");
}
