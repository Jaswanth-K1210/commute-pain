import { randomUUID } from "node:crypto";
import { getRoute, sb, storageUrl } from "@/lib/db";
import { getSession } from "@/lib/session";

// The channel rules, enforced here (shown in the UI too).
const TTL_MS = 3 * 60 * 60_000;       // messages vanish after 3h
const COOLDOWN_MS = 10_000;           // one transmission per 10s
const MAX_TEXT = 140;
const MAX_AUDIO = 400_000;            // ~15s of opus
const PHONE = /(\+?\d[\d\s-]{8,}\d)/; // no phone numbers on air

type Row = { id: number; kind: "text" | "voice"; body: string | null; audio_path: string | null; created_at: string; user: { name: string } };

async function withUrls(rows: Row[]) {
  const paths = rows.flatMap((r) => (r.audio_path ? [r.audio_path] : []));
  const signed = paths.length
    ? await sb<{ path: string; signedURL: string | null }[]>("/storage/v1/object/sign/radio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 3600, paths }),
      })
    : [];
  const url = new Map(signed.map((s) => [s.path, s.signedURL ? storageUrl(s.signedURL) : null]));
  return rows.map((r) => ({ id: r.id, kind: r.kind, body: r.body, user: r.user.name, created_at: r.created_at, url: r.audio_path ? url.get(r.audio_path) ?? null : null }));
}

const SELECT = "id,kind,body,audio_path,created_at,user:users(name)";

export async function GET(req: Request, ctx: RouteContext<"/api/radio/[slug]">) {
  if (!(await getSession())) return Response.json({ error: "login to tune in" }, { status: 401 });
  const route = await getRoute((await ctx.params).slug);
  if (!route) return Response.json({ error: "no such channel" }, { status: 404 });
  const after = Number(new URL(req.url).searchParams.get("after")) || 0;
  const since = new Date(Date.now() - TTL_MS).toISOString();
  const rows = await sb<Row[]>(`/rest/v1/radio_messages?select=${SELECT}&route_id=eq.${route.id}&id=gt.${after}&created_at=gt.${since}&order=id.asc&limit=50`);
  return Response.json({ messages: await withUrls(rows) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/radio/[slug]">) {
  const me = await getSession();
  if (!me) return Response.json({ error: "login to talk" }, { status: 401 });
  const route = await getRoute((await ctx.params).slug);
  if (!route) return Response.json({ error: "no such channel" }, { status: 404 });

  const [last] = await sb<{ created_at: string }[]>(`/rest/v1/radio_messages?select=created_at&user_id=eq.${me.id}&order=created_at.desc&limit=1`);
  const wait = last ? COOLDOWN_MS - (Date.now() - new Date(last.created_at).getTime()) : 0;
  if (wait > 0) return Response.json({ error: `breathe 😮‍💨 ${Math.ceil(wait / 1000)}s cooldown` }, { status: 429 });

  const form = await req.formData();
  const audio = form.get("audio");
  let row: { kind: "text" | "voice"; body?: string; audio_path?: string };

  if (audio instanceof File) {
    if (!audio.type.startsWith("audio/") || audio.size > MAX_AUDIO || audio.size < 1000)
      return Response.json({ error: "clip must be audio, 1–15s" }, { status: 400 });
    const type = audio.type.split(";")[0];
    const path = `${route.id}/${randomUUID()}.${type.includes("mp4") || type.includes("aac") ? "m4a" : type.split("/")[1]}`;
    await sb(`/storage/v1/object/radio/${path}`, { method: "POST", body: audio, headers: { "Content-Type": type } });
    row = { kind: "voice", audio_path: path };
  } else {
    const body = String(form.get("text") ?? "").trim();
    if (!body || body.length > MAX_TEXT) return Response.json({ error: `1–${MAX_TEXT} chars, over` }, { status: 400 });
    if (PHONE.test(body)) return Response.json({ error: "no phone numbers on air 🙅" }, { status: 400 });
    row = { kind: "text", body };
  }

  const [saved] = await sb<Row[]>(`/rest/v1/radio_messages?select=${SELECT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ ...row, route_id: route.id, user_id: me.id }),
  });
  return Response.json({ message: (await withUrls([saved]))[0] });
}
