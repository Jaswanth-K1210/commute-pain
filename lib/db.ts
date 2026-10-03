// Server-only MongoDB access. Never import from a client component.
import { MongoClient, ObjectId, type Db } from "mongodb";
import { unstable_cache } from "next/cache";
import type { Slot } from "./pain";

export const MAX_ROUTES = 45; // TomTom free tier budget, keep in sync with logger.py
export const MAX_PER_USER = 3;

export type Place = { label: string; lat: number; lng: number };
export type UserDoc = { _id: ObjectId; name: string; pin_hash: string; failed_pins: number; locked_until: Date | null; created_at: Date };
export type RouteDoc = {
  _id: ObjectId; slug: string; ch: number; name: string; owner_id: ObjectId | null; owner_name: string | null;
  origin: Place; dest: Place; active: boolean; created_at: Date;
};
export type LogDoc = {
  route_id: ObjectId; duration_sec: number; traffic_delay_sec: number; distance_m: number;
  alternatives: { duration_sec: number; distance_m: number }[]; logged_at: Date;
};

/** What pages get: plain, serializable. */
export type Route = { id: string; slug: string; ch: number; name: string; owner_id: string | null; owner_name: string | null; origin_label: string; dest_label: string };
export type Latest = Omit<LogDoc, "route_id" | "logged_at"> & { route_id: string; logged_at: string };

// One client per server instance (survives hot reload in dev).
const g = globalThis as unknown as { _mongo?: Promise<Db> };
export function db(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error("MONGODB_URI not set"));
  return (g._mongo ??= new MongoClient(uri, { maxPoolSize: 5 }).connect().then(async (c) => {
    const d = c.db(process.env.MONGODB_DB || "commute_pain");
    await d.collection("users").createIndex({ name: 1 }, { unique: true }); // idempotent
    await d.collection("routes").createIndex({ slug: 1 }, { unique: true });
    return d;
  }).catch((e) => { g._mongo = undefined; throw e; }));
}

export const col = async <T extends object>(name: "users" | "routes" | "commute_logs") => (await db()).collection<T>(name);

const toRoute = (r: RouteDoc): Route => ({
  id: r._id.toHexString(), slug: r.slug, ch: r.ch, name: r.name,
  owner_id: r.owner_id?.toHexString() ?? null, owner_name: r.owner_name,
  origin_label: r.origin.label, dest_label: r.dest.label,
});

/** Soft read: UI shows "collecting data…" instead of a 500 when the DB is unreachable. */
async function soft<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.error(e); return fallback; }
}

export const getRoutes = (filter: Partial<Pick<RouteDoc, "owner_id">> = {}) =>
  soft(async () => (await (await col<RouteDoc>("routes")).find({ active: true, ...filter }).sort({ ch: 1 }).toArray()).map(toRoute), []);

export const getRoute = (slug: string) =>
  soft(async () => { const r = await (await col<RouteDoc>("routes")).findOne({ slug }); return r ? toRoute(r) : undefined; }, undefined);

const IST = "Asia/Kolkata";

/** Median minutes per route × IST weekday (0=Mon) × half-hour slot, last 8 weeks. One aggregation for all routes, cached 5 min. */
const allSlots = unstable_cache(
  () => soft(async () => {
    const rows = await (await col<LogDoc>("commute_logs")).aggregate<{ _id: { r: ObjectId; d: number; h: number; half: boolean }; median: number; n: number }>([
      { $match: { logged_at: { $gt: new Date(Date.now() - 56 * 86400_000) } } },
      { $group: {
        _id: {
          r: "$route_id",
          d: { $dayOfWeek: { date: "$logged_at", timezone: IST } },
          h: { $hour: { date: "$logged_at", timezone: IST } },
          half: { $gte: [{ $minute: { date: "$logged_at", timezone: IST } }, 30] },
        },
        median: { $median: { input: "$duration_sec", method: "approximate" } },
        n: { $sum: 1 },
      } },
    ]).toArray();
    const out: Record<string, Slot[]> = {};
    for (const { _id, median, n } of rows) {
      // $dayOfWeek: 1=Sun..7=Sat → 0=Mon..6=Sun
      (out[_id.r.toHexString()] ??= []).push({ dow: (_id.d + 5) % 7, slot: _id.h * 2 + (_id.half ? 1 : 0), median_min: Math.round(median / 6) / 10, n });
    }
    return out;
  }, {} as Record<string, Slot[]>),
  ["slots"],
  { revalidate: 300 },
);
export const getSlots = async (routeId: string) => (await allSlots())[routeId] ?? [];

/** Latest reading per route (from the last 2h; older = stale anyway). */
export const getLatest = () =>
  soft(async () => {
    const rows = await (await col<LogDoc>("commute_logs")).aggregate<LogDoc>([
      { $match: { logged_at: { $gt: new Date(Date.now() - 2 * 3600_000) } } },
      { $sort: { logged_at: -1 } },
      { $group: { _id: "$route_id", doc: { $first: "$$ROOT" } } },
      { $replaceWith: "$doc" },
      { $project: { _id: 0 } },
    ]).toArray();
    return rows.map((l): Latest => ({ ...l, route_id: l.route_id.toHexString(), logged_at: l.logged_at.toISOString() }));
  }, [] as Latest[]);

export { ObjectId };
