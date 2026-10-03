import { getSession } from "@/lib/session";

// Place search for the profile page. Login required so randoms can't burn the TomTom quota.
export async function GET(req: Request) {
  if (!(await getSession())) return Response.json({ error: "login first" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 80);
  const key = process.env.TOMTOM_API_KEY;
  if (!q || q.length < 3) return Response.json({ results: [] });
  if (!key) return Response.json({ error: "TOMTOM_API_KEY not set" }, { status: 500 });

  const url = new URL(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json`);
  Object.entries({ key, limit: "6", countrySet: "IN", lat: "17.42", lon: "78.42", radius: "60000", language: "en-GB" })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { next: { revalidate: 86400 } }); // same query → cached a day, saves quota
  if (!res.ok) return Response.json({ error: "search failed" }, { status: 502 });

  type Hit = { poi?: { name: string }; address: { freeformAddress: string }; position: { lat: number; lon: number } };
  const { results } = (await res.json()) as { results: Hit[] };
  return Response.json({
    results: results.map((r) => ({
      label: r.poi ? `${r.poi.name}, ${r.address.freeformAddress}` : r.address.freeformAddress,
      lat: r.position.lat,
      lng: r.position.lon,
    })),
  });
}
