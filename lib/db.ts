// Server-only Supabase access over REST with the service key. Never import from a client component.
import type { Slot } from "./pain";

export const MAX_ROUTES = 45; // TomTom free tier budget, keep in sync with logger.py
export const MAX_PER_USER = 3;

export type Route = {
  id: number; slug: string; name: string; owner_id: string | null;
  origin_label: string | null; dest_label: string | null; owner: { name: string } | null;
};
export type Alt = { duration_sec: number; distance_m: number };
export type Latest = { route_id: number; duration_sec: number; traffic_delay_sec: number; distance_m: number; alternatives: Alt[]; logged_at: string };

const URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY;

export const storageUrl = (p: string) => `${URL}/storage/v1${p}`;

/** Raw call; throws on HTTP errors. Legacy JWT keys also need a bearer token, new sb_secret_ keys must not send one. */
export async function sb<T = unknown>(path: string, init: RequestInit & { next?: { revalidate: number } } = {}): Promise<T> {
  if (!URL || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const auth: Record<string, string> = KEY.startsWith("ey") ? { Authorization: `Bearer ${KEY}` } : {};
  const res = await fetch(URL + path, { cache: "no-store", ...init, headers: { apikey: KEY, ...auth, ...init.headers } });
  if (!res.ok) throw new Error(`supabase ${res.status} ${path.split("?")[0]}: ${await res.text()}`);
  return (res.status === 204 || res.headers.get("content-length") === "0" ? null : await res.json()) as T;
}

/** Soft read: UI shows "collecting data…" instead of a 500 when the DB is unreachable. */
async function read<T>(path: string, revalidate?: number): Promise<T[]> {
  try {
    return await sb<T[]>(`/rest/v1/${path}`, revalidate ? { cache: undefined, next: { revalidate } } : {});
  } catch (e) {
    console.error(e);
    return [];
  }
}

const ROUTE_COLS = "id,slug,name,owner_id,origin_label,dest_label,owner:users(name)";
export const getRoutes = () => read<Route>(`routes?select=${ROUTE_COLS}&active=eq.true&order=id`);
export const getRoute = async (slug: string) => (await read<Route>(`routes?select=${ROUTE_COLS}&slug=eq.${encodeURIComponent(slug)}`))[0];
export const getSlots = (routeId: number) => read<Slot>(`slot_stats?route_id=eq.${routeId}&select=dow,slot,median_min,n`, 300);
export const getLatest = () => read<Latest>("latest_logs?select=*", 60);
