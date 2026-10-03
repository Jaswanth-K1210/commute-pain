"""Log traffic-aware travel times for every active route into MongoDB Atlas.

Env: TOMTOM_API_KEY, MONGODB_URI (optional MONGODB_DB, default "commute_pain").
Runs every 30 min, 4:30am–1:30am IST (see .github/workflows/log.yml).
Budget: <= MAX_ROUTES requests/run x 42 runs/day = 1,890/day, under TomTom's 2,500/day free tier
(alternatives come back in the same request, so they're free).
"""
import os
import sys
from datetime import datetime, timezone

import requests
from pymongo import ASCENDING, DESCENDING, MongoClient

MAX_ROUTES = 45  # keep in sync with lib/db.ts
LOG_TTL_DAYS = 60  # stats only use 8 weeks; TTL keeps the free 512MB cluster small
TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute/{o}:{d}/json"

# Community seed routes, inserted once (edit coordinates in Atlas → Browse Collections → routes).
SEEDS = [
    ("Gachibowli", 17.4401, 78.3489, "Ameerpet", 17.4375, 78.4483),
    ("HITEC City", 17.4474, 78.3762, "Kukatpally", 17.4849, 78.4138),
    ("Financial District", 17.4156, 78.3410, "Secunderabad", 17.4399, 78.4983),
    ("Madhapur", 17.4483, 78.3915, "LB Nagar", 17.3457, 78.5522),
    ("Kondapur", 17.4600, 78.3570, "Miyapur", 17.4968, 78.3614),
    ("Raidurg", 17.4270, 78.3810, "Banjara Hills", 17.4156, 78.4347),
]


def setup(db):
    """Idempotent: indexes + seed routes."""
    db.commute_logs.create_index([("route_id", ASCENDING), ("logged_at", DESCENDING)])
    db.commute_logs.create_index("logged_at", expireAfterSeconds=LOG_TTL_DAYS * 86400)
    db.routes.create_index("slug", unique=True)
    db.users.create_index("name", unique=True)
    for ch, (o, olat, olng, d, dlat, dlng) in enumerate(SEEDS, start=1):
        slug = f"{o}-{d}".lower().replace(" ", "-")
        db.routes.update_one({"slug": slug}, {"$setOnInsert": {
            "slug": slug, "ch": ch, "name": f"{o}→{d}", "owner_id": None, "owner_name": None,
            "origin": {"label": o, "lat": olat, "lng": olng}, "dest": {"label": d, "lat": dlat, "lng": dlng},
            "active": True, "created_at": datetime.now(timezone.utc),
        }}, upsert=True)


def fetch_route(session, key, r):
    o, d = r["origin"], r["dest"]
    resp = session.get(
        TOMTOM_URL.format(o=f"{o['lat']},{o['lng']}", d=f"{d['lat']},{d['lng']}"),
        params={"key": key, "traffic": "true", "travelMode": "car", "routeType": "fastest", "maxAlternatives": 2},
        timeout=20,
    )
    resp.raise_for_status()
    main, *alts = [x["summary"] for x in resp.json()["routes"]]
    return {
        "route_id": r["_id"],
        "duration_sec": main["travelTimeInSeconds"],
        "traffic_delay_sec": main.get("trafficDelayInSeconds", 0),
        "distance_m": main["lengthInMeters"],
        "alternatives": [{"duration_sec": a["travelTimeInSeconds"], "distance_m": a["lengthInMeters"]} for a in alts],
    }


def main():
    key, uri = os.environ.get("TOMTOM_API_KEY"), os.environ.get("MONGODB_URI")
    if not key or not uri:
        sys.exit("Missing env vars: TOMTOM_API_KEY and/or MONGODB_URI")

    db = MongoClient(uri, serverSelectionTimeoutMS=15000)[os.environ.get("MONGODB_DB") or "commute_pain"]
    setup(db)
    routes = list(db.routes.find({"active": True}).sort("ch", ASCENDING).limit(MAX_ROUTES))

    logged_at = datetime.now(timezone.utc)  # one timestamp per run -> same slot
    rows, sent = [], 0
    with requests.Session() as session:
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
        db.commute_logs.insert_many(rows)
        print(f"Inserted {len(rows)}/{len(routes)} rows.")
    except Exception as e:
        print(f"[fail] Mongo insert: {e}")
        sys.exit(1)  # data was lost this run; make the Action go red


if __name__ == "__main__":
    main()
