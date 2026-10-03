"""Log traffic-aware travel times for every active route into Supabase, and expire old radio chatter.

Env: TOMTOM_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY. Runs every 30 min, 4:30am–1:30am IST (see .github/workflows/log.yml).
Budget: <= MAX_ROUTES requests/run x 42 runs/day = 1,890/day, under TomTom's 2,500/day free tier
(alternatives come back in the same request, so they're free).
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

MAX_ROUTES = 45  # keep in sync with lib/db.ts
RADIO_TTL = timedelta(hours=3)
TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute/{o}:{d}/json"


def fetch_route(session, key, r):
    resp = session.get(
        TOMTOM_URL.format(o=f"{r['origin_lat']},{r['origin_lng']}", d=f"{r['dest_lat']},{r['dest_lng']}"),
        params={"key": key, "traffic": "true", "travelMode": "car", "routeType": "fastest", "maxAlternatives": 2},
        timeout=20,
    )
    resp.raise_for_status()
    main, *alts = [x["summary"] for x in resp.json()["routes"]]
    return {
        "route_id": r["id"],
        "duration_sec": main["travelTimeInSeconds"],
        "traffic_delay_sec": main.get("trafficDelayInSeconds", 0),
        "distance_m": main["lengthInMeters"],
        "alternatives": [{"duration_sec": a["travelTimeInSeconds"], "distance_m": a["lengthInMeters"]} for a in alts],
    }


def expire_radio(session, sb, headers):
    cutoff = (datetime.now(timezone.utc) - RADIO_TTL).isoformat()
    old = session.get(f"{sb}/rest/v1/radio_messages", params={"select": "id,audio_path", "created_at": f"lt.{cutoff}"}, headers=headers, timeout=20)
    old.raise_for_status()
    rows = old.json()
    if not rows:
        return
    if paths := [r["audio_path"] for r in rows if r["audio_path"]]:
        session.delete(f"{sb}/storage/v1/object/radio", json={"prefixes": paths}, headers=headers, timeout=20).raise_for_status()
    session.delete(f"{sb}/rest/v1/radio_messages", params={"created_at": f"lt.{cutoff}"}, headers=headers, timeout=20).raise_for_status()
    print(f"Radio: expired {len(rows)} messages ({len(paths)} clips).")


def main():
    env = {k: os.environ.get(k) for k in ("TOMTOM_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY")}
    if missing := [k for k, v in env.items() if not v]:
        sys.exit(f"Missing env vars: {', '.join(missing)}")
    key, sb = env["TOMTOM_API_KEY"], env["SUPABASE_URL"].rstrip("/")
    sk = env["SUPABASE_SERVICE_KEY"]
    headers = {"apikey": sk, "Content-Type": "application/json"}
    if sk.startswith("ey"):  # legacy JWT service_role key also wants a bearer token; new sb_secret_ keys must not send one
        headers["Authorization"] = f"Bearer {sk}"

    with requests.Session() as session:
        try:
            expire_radio(session, sb, headers)
        except Exception as e:  # cleanup is best-effort; logging traffic matters more
            print(f"[warn] radio cleanup: {e}")

        r = session.get(
            f"{sb}/rest/v1/routes",
            params={"select": "id,name,origin_lat,origin_lng,dest_lat,dest_lng", "active": "eq.true", "order": "id", "limit": MAX_ROUTES},
            headers=headers, timeout=20,
        )
        r.raise_for_status()
        routes = r.json()

        logged_at = datetime.now(timezone.utc).isoformat()  # one timestamp per run -> same slot
        rows, sent = [], 0
        for route in routes:
            sent += 1
            try:
                row = fetch_route(session, key, route)
                rows.append({**row, "logged_at": logged_at})
                print(f"[ok]   {route['name']}: {row['duration_sec'] / 60:.1f} min, {len(row['alternatives'])} alts")
            except Exception as e:  # one bad route must not kill the run
                print(f"[skip] {route['name']}: {str(e).replace(key, '***')}")  # URLs contain the key

        print(f"TomTom requests this run: {sent} (~{sent * 42}/day vs 2,500 free)")
        if not rows:
            print("Nothing to insert.")
            return
        try:
            session.post(f"{sb}/rest/v1/commute_logs", json=rows, headers={**headers, "Prefer": "return=minimal"}, timeout=20).raise_for_status()
            print(f"Inserted {len(rows)}/{len(routes)} rows.")
        except Exception as e:
            print(f"[fail] Supabase insert: {e} {getattr(getattr(e, 'response', None), 'text', '')}")
            sys.exit(1)  # data was lost this run; make the Action go red


if __name__ == "__main__":
    main()
