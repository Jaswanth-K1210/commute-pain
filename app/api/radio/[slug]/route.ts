import { randomUUID } from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { getRoute } from "@/lib/db";
import { getSession } from "@/lib/session";

// Hands out a short-lived LiveKit ticket for this route's live channel. Nothing is recorded or stored.
export async function GET(_: Request, ctx: RouteContext<"/api/radio/[slug]">) {
  const me = await getSession();
  if (!me) return Response.json({ error: "login to tune in" }, { status: 401 });
  const route = await getRoute((await ctx.params).slug);
  if (!route) return Response.json({ error: "no such channel" }, { status: 404 });

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return Response.json({ error: "radio not configured" }, { status: 500 });

  // suffix so the same player can be tuned in from two tabs/devices
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: `${me.name}~${randomUUID().slice(0, 6)}`, name: me.name, ttl: "2h" });
  at.addGrant({
    room: `route-${route.slug}`, roomJoin: true, canSubscribe: true, canPublishData: true,
    canPublish: true, canPublishSources: [TrackSource.MICROPHONE], // voice only, no cams/screens
  });
  return Response.json({ url: LIVEKIT_URL, token: await at.toJwt() });
}
