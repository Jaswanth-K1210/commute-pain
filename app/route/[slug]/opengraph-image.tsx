import { ImageResponse } from "next/og";
import { getRoute, getSlots } from "@/lib/db";
import { brag } from "@/lib/pain";

export const alt = "Commute pain card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Google serves TTF (which Satori needs) when the request has no browser UA.
async function pixelFont() {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Press+Start+2P")).text();
    const url = css.match(/src: url\((.+?)\)/)?.[1];
    return url ? [{ name: "Press", data: await (await fetch(url)).arrayBuffer(), weight: 400 as const }] : undefined;
  } catch {
    return undefined; // fall back to the default font rather than failing the card
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const route = await getRoute((await params).slug);
  const name = (route?.name ?? "Unknown route").replace("→", " > "); // pixel font has no arrow glyph
  const line = route ? brag(await getSlots(route.id)) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          background: "#fff6e9", color: "#2b2340", padding: 56, fontFamily: "Press",
          border: "16px solid #2b2340",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, color: "#6f6688" }}>
          {route?.owner ? `@${route.owner.name.toUpperCase()}'S COMMUTE` : "COMMUTE PAIN TRACKER · HYD"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 44, lineHeight: 1.4 }}>{name}</div>
          <div
            style={{
              display: "flex", fontSize: 34, lineHeight: 1.6, background: "#ffb3c6", padding: "24px 28px",
              border: "6px solid #2b2340", boxShadow: "10px 10px 0 #2b2340", borderRadius: 10,
            }}
          >
            {line ?? "collecting data... the pain is loading"}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}>
          <span>GAME OVER FOR YOUR EVENING</span>
          <span style={{ color: "#6f6688" }}>PRESS START</span>
        </div>
      </div>
    ),
    { ...size, fonts: await pixelFont() },
  );
}
